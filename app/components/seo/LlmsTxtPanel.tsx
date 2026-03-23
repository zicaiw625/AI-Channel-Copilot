import { useAppBridge } from "@shopify/app-bridge-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useFetcher, useLocation } from "react-router";
import type { SettingsDefaults } from "../../lib/aiData";
import type { LlmsStatus } from "../../lib/llms.server";
import { buildAiVisibilityHref, buildBillingHref } from "../../lib/navigation";

type ExposurePreferences = SettingsDefaults["exposurePreferences"];

type StatusInfo = {
  status: LlmsStatus;
  publicUrl: string;
  cachedAt: string | null;
};

type PreviewResponse = {
  ok: boolean;
  text?: string;
  message?: string;
};

type SyncResponse = {
  ok: boolean;
  status?: LlmsStatus;
  publicUrl?: string;
  cachedAt?: string | null;
  exposurePreferences?: ExposurePreferences;
  autoEnabledProducts?: boolean;
  text?: string;
  message?: string;
};

type Props = {
  language: string;
  shopDomain: string;
  initialStatus: StatusInfo;
  initialExposurePreferences: ExposurePreferences;
  canManage?: boolean;
  canUseAdvanced: boolean;
  editable?: boolean;
  compact?: boolean;
  showPreview?: boolean;
  settingsHref?: string;
  workspaceHref?: string;
  exposurePreferences?: ExposurePreferences;
  onExposurePreferencesChange?: (next: ExposurePreferences) => void;
  context?: "dashboard" | "workspace" | "settings";
};

const statusMeta = (language: string, status: LlmsStatus) => {
  const en = language === "English";

  switch (status) {
    case "active":
      return {
        label: en ? "Active" : "已生效",
        tone: { bg: "#e6f7ed", border: "#b7eb8f", color: "#389e0d" },
        description: en ? "Live URL is serving the synced llms.txt cache." : "公开地址正在提供已同步的 llms.txt 缓存。",
      };
    case "ready_to_sync":
      return {
        label: en ? "Ready to Sync" : "待同步",
        tone: { bg: "#fff7e6", border: "#ffd591", color: "#d46b08" },
        description: en ? "Settings exist, but llms.txt has not been synced yet." : "设置已存在，但 llms.txt 还没有真正同步上线。",
      };
    case "partial":
      return {
        label: en ? "Partial / Needs Refresh" : "部分生效 / 需刷新",
        tone: { bg: "#fff1f0", border: "#ffa39e", color: "#cf1322" },
        description: en ? "Live URL may fall back to partial content until you sync again." : "公开地址可能回退到不完整内容，重新同步后才能恢复一致。",
      };
    case "error":
      return {
        label: en ? "Error" : "异常",
        tone: { bg: "#fff1f0", border: "#ffa39e", color: "#cf1322" },
        description: en ? "We could not determine the current llms.txt state." : "当前无法确定 llms.txt 的实际状态。",
      };
    case "not_configured":
    default:
      return {
        label: en ? "Not Configured" : "未配置",
        tone: { bg: "#f4f6f8", border: "#dfe3e8", color: "#637381" },
        description: en ? "No content types are enabled for AI discovery yet." : "当前还没有为 AI 发现开启任何内容类型。",
      };
  }
};

const formatCachedAt = (language: string, value: string | null) => {
  if (!value) {
    return language === "English" ? "Never synced" : "尚未同步";
  }

  return new Intl.DateTimeFormat(language === "English" ? "en-US" : "zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
};

const exposureSummary = (language: string, exposure: ExposurePreferences) => {
  const labels = [
    exposure.exposeProducts ? (language === "English" ? "Products" : "产品") : null,
    exposure.exposeCollections ? (language === "English" ? "Collections" : "集合") : null,
    exposure.exposeBlogs ? (language === "English" ? "Blog" : "博客") : null,
  ].filter(Boolean);

  if (!labels.length) {
    return language === "English" ? "No content enabled yet" : "尚未启用任何内容";
  }

  return labels.join(" / ");
};

export function LlmsTxtPanel({
  language,
  shopDomain,
  initialStatus,
  initialExposurePreferences,
  canManage = true,
  canUseAdvanced,
  editable = false,
  compact = false,
  showPreview = true,
  settingsHref,
  workspaceHref,
  exposurePreferences,
  onExposurePreferencesChange,
  context = "settings",
}: Props) {
  const en = language === "English";
  const shopify = useAppBridge();
  const location = useLocation();
  const syncFetcher = useFetcher<SyncResponse>();
  const previewFetcher = useFetcher<PreviewResponse>();
  const [localExposurePreferences, setLocalExposurePreferences] = useState(initialExposurePreferences);
  const [statusInfo, setStatusInfo] = useState<StatusInfo>(initialStatus);
  const [previewText, setPreviewText] = useState("");
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewFetcherLoadRef = useRef(previewFetcher.load);

  const activeExposurePreferences = exposurePreferences ?? localExposurePreferences;
  const meta = statusMeta(language, statusInfo.status);
  const liveUrl = statusInfo.publicUrl || (shopDomain ? `https://${shopDomain}/a/llms` : "");
  const billingHref = buildBillingHref(location.search);
  const defaultWorkspaceHref = workspaceHref || buildAiVisibilityHref(location.search, { tab: "llms", fromTab: null, backTo: null });
  const downloadHref = canUseAdvanced ? "/api/llms-txt-preview?download=1" : billingHref;

  const updateExposurePreferences = useCallback((next: ExposurePreferences) => {
    if (!exposurePreferences) {
      setLocalExposurePreferences(next);
    }
    onExposurePreferencesChange?.(next);
  }, [exposurePreferences, onExposurePreferencesChange]);

  useEffect(() => {
    setStatusInfo(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    if (!exposurePreferences) {
      setLocalExposurePreferences(initialExposurePreferences);
    }
  }, [exposurePreferences, initialExposurePreferences]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    previewFetcherLoadRef.current = previewFetcher.load;
  }, [previewFetcher.load]);

  const requestPreview = useCallback(() => {
    previewFetcherLoadRef.current(`/api/llms-txt-preview?lang=${encodeURIComponent(language)}`);
  }, [language]);

  useEffect(() => {
    if (!canUseAdvanced || !showPreview || !shopDomain) {
      return;
    }

    requestPreview();
  }, [canUseAdvanced, requestPreview, shopDomain, showPreview]);

  useEffect(() => {
    const data = syncFetcher.data;

    if (!data) {
      return;
    }

    if (!data.ok) {
      shopify.toast.show?.(data.message || (en ? "Failed to sync llms.txt" : "同步 llms.txt 失败"));
      return;
    }

    const nextStatus: StatusInfo = {
      status: data.status || "active",
      publicUrl: data.publicUrl || liveUrl,
      cachedAt: data.cachedAt ?? new Date().toISOString(),
    };

    setStatusInfo(nextStatus);

    if (data.exposurePreferences) {
      updateExposurePreferences(data.exposurePreferences);
    }

    if (typeof data.text === "string") {
      setPreviewText(data.text);
    } else if (canUseAdvanced && showPreview) {
      requestPreview();
    }

    shopify.toast.show?.(
      data.autoEnabledProducts
        ? (en ? "Products were enabled and llms.txt is now live." : "已自动启用产品暴露，llms.txt 现已上线。")
        : (en ? "llms.txt synced successfully." : "llms.txt 已同步成功。"),
    );
  }, [canUseAdvanced, en, liveUrl, requestPreview, shopify, showPreview, syncFetcher.data, updateExposurePreferences]);

  useEffect(() => {
    const data = previewFetcher.data;

    if (!data) {
      return;
    }

    if (data.ok && typeof data.text === "string") {
      setPreviewText(data.text);
      return;
    }

    if (!data.ok) {
      setPreviewText(data.message || (en ? "Failed to load preview." : "预览加载失败。"));
    }
  }, [en, previewFetcher.data]);

  const previewBlockedMessage = en
    ? "Preview, copy, and download are available on Pro and Growth plans."
    : "预览、复制和下载功能仅在 Pro 和 Growth 计划可用。";
  const syncBlockedMessage = en
    ? "Start a paid plan to generate and sync llms.txt."
    : "请先启用付费套餐，再生成并同步 llms.txt。";

  const isPreviewLoading = previewFetcher.state === "loading";
  const resolvedPreviewText = useMemo(() => {
    if (!canUseAdvanced) {
      return previewBlockedMessage;
    }

    if (isPreviewLoading && !previewText) {
      return en ? "Loading preview..." : "正在加载预览...";
    }

    return previewText || (en ? "Click sync to generate your llms.txt." : "点击同步后生成 llms.txt。");
  }, [canUseAdvanced, en, isPreviewLoading, previewBlockedMessage, previewText]);

  const handleSync = () => {
    if (!canManage) {
      shopify.toast.show?.(syncBlockedMessage);
      return;
    }

    syncFetcher.submit(
      {
        exposurePreferences: JSON.stringify(activeExposurePreferences),
      },
      { method: "post", action: "/api/llms-sync" },
    );
  };

  const handleCopy = async () => {
    if (!canUseAdvanced || !previewText) {
      shopify.toast.show?.(previewBlockedMessage);
      return;
    }

    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current);
    }

    try {
      await navigator.clipboard.writeText(previewText);
      setCopied(true);
      copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      shopify.toast.show?.(en ? "Copy failed" : "复制失败");
    }
  };

  return (
    <div
      style={{
        border: "1px solid #e1e3e5",
        borderRadius: 12,
        padding: compact ? 18 : 20,
        background: "#fff",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ maxWidth: compact ? "100%" : "70%" }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: "#637381", textTransform: "uppercase", letterSpacing: 0.4 }}>
            llms.txt
          </p>
          <h3 style={{ margin: "6px 0 8px", fontSize: compact ? 20 : 22 }}>
            {en ? "AI SEO / llms.txt" : "AI SEO / llms.txt"}
          </h3>
          <p style={{ margin: 0, color: "#637381", lineHeight: 1.6 }}>
            {compact
              ? (en ? "Make llms.txt a visible, reliable product entry point." : "把 llms.txt 变成首页可见、可信的产品入口。")
              : (en
                ? "Use one real workflow to configure, sync, preview, and verify the live llms.txt your store serves."
                : "用一套真实链路完成 llms.txt 的配置、同步、预览和线上校验。")}
          </p>
        </div>

        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "6px 10px",
            borderRadius: 999,
            background: meta.tone.bg,
            border: `1px solid ${meta.tone.border}`,
            color: meta.tone.color,
            fontSize: 13,
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
        >
          {meta.label}
        </span>
      </div>

      <div style={{ marginTop: 14, padding: "12px 14px", background: "#f6f6f7", borderRadius: 10 }}>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ color: "#111827", fontWeight: 500 }}>
            {en ? "Live URL:" : "线上地址："}{" "}
            <a href={liveUrl} target="_blank" rel="noreferrer" style={{ color: "#005bd3" }}>
              {liveUrl}
            </a>
          </span>
          <span style={{ color: "#637381" }}>
            {en ? "Last synced:" : "最近同步："} {formatCachedAt(language, statusInfo.cachedAt)}
          </span>
          <span style={{ color: "#637381" }}>
            {en ? "Enabled content:" : "已启用内容："} {exposureSummary(language, activeExposurePreferences)}
          </span>
        </div>
        <p style={{ margin: "8px 0 0", color: "#637381", lineHeight: 1.5 }}>{meta.description}</p>
      </div>

      {editable && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginTop: 16 }}>
          {([
            ["exposeProducts", en ? "Product pages" : "产品页", en ? "Products and product details in llms.txt" : "在 llms.txt 中包含产品及产品详情"],
            ["exposeCollections", en ? "Collections" : "集合页", en ? "Collections and category landing pages" : "包含集合与分类落地页"],
            ["exposeBlogs", en ? "Blog content" : "博客内容", en ? "Blog and editorial content" : "包含博客与内容文章"],
          ] as const).map(([key, label, help]) => {
            const checkboxId = `llms-${context}-${key}`;
            const helpId = `${checkboxId}-help`;

            return (
              <div
                key={key}
                style={{
                  display: "flex",
                  gap: 10,
                  padding: 12,
                  border: "1px solid #e1e3e5",
                  borderRadius: 10,
                  alignItems: "flex-start",
                }}
              >
                <input
                  id={checkboxId}
                  type="checkbox"
                  aria-describedby={helpId}
                  checked={activeExposurePreferences[key]}
                  onChange={(event) =>
                    updateExposurePreferences({
                      ...activeExposurePreferences,
                      [key]: event.target.checked,
                    })
                  }
                />
                <span>
                  <label htmlFor={checkboxId} style={{ display: "block", marginBottom: 4 }}>
                    <strong>{label}</strong>
                  </label>
                  <span id={helpId} style={{ color: "#637381", fontSize: 13 }}>{help}</span>
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
        <button
          type="button"
          onClick={handleSync}
          disabled={!canManage || syncFetcher.state !== "idle"}
          style={{
            padding: "10px 16px",
            border: "none",
            borderRadius: 8,
            background: "#111827",
            color: "#fff",
            cursor: !canManage ? "not-allowed" : syncFetcher.state !== "idle" ? "wait" : "pointer",
            opacity: !canManage || syncFetcher.state !== "idle" ? 0.7 : 1,
            fontWeight: 600,
          }}
        >
          {syncFetcher.state !== "idle"
            ? (en ? "Syncing..." : "同步中...")
            : (en ? "Generate & Sync llms.txt" : "生成并同步 llms.txt")}
        </button>
        <a
          href={liveUrl}
          target="_blank"
          rel="noreferrer"
          style={{
            padding: "10px 16px",
            border: "1px solid #c4cdd5",
            borderRadius: 8,
            color: "#111827",
            textDecoration: "none",
            fontWeight: 500,
          }}
        >
          {en ? "View live" : "查看线上版本"}
        </a>
        {context === "dashboard" && (
          <Link
            to={defaultWorkspaceHref}
            style={{
              padding: "10px 16px",
              border: "1px solid #c4cdd5",
              borderRadius: 8,
              color: "#111827",
              textDecoration: "none",
              fontWeight: 500,
            }}
          >
            {en ? "Open Workspace" : "打开工作台"}
          </Link>
        )}
        {context === "workspace" && (
          <>
            <button
              type="button"
              onClick={handleCopy}
              disabled={!canUseAdvanced || !previewText}
              style={{
                padding: "10px 16px",
                border: "1px solid #c4cdd5",
                borderRadius: 8,
                background: "#fff",
                cursor: !canUseAdvanced || !previewText ? "not-allowed" : "pointer",
                opacity: !canUseAdvanced || !previewText ? 0.6 : 1,
                fontWeight: 500,
              }}
            >
              {copied ? (en ? "Copied" : "已复制") : (en ? "Copy" : "复制")}
            </button>
            <a
              href={downloadHref}
              style={{
                padding: "10px 16px",
                borderRadius: 8,
                background: "#fff",
                border: "1px solid #c4cdd5",
                color: "#111827",
                textDecoration: "none",
                opacity: canUseAdvanced ? 1 : 0.6,
                fontWeight: 500,
              }}
            >
              {en ? "Download" : "下载"}
            </a>
          </>
        )}
        {context === "settings" && settingsHref && (
          <Link
            to={settingsHref}
            style={{
              padding: "10px 16px",
              border: "1px solid #c4cdd5",
              borderRadius: 8,
              color: "#111827",
              textDecoration: "none",
              fontWeight: 500,
            }}
          >
            {en ? "Open detailed settings" : "打开详细设置"}
          </Link>
        )}
      </div>
      {context === "settings" && (
        <p style={{ margin: "10px 0 0", color: "#637381" }}>
          {en ? "Use this page for advanced exposure controls and sync management." : "此页用于调整高级暴露选项和同步管理。"}
        </p>
      )}
      {!canManage && (
        <p style={{ margin: "10px 0 0", color: "#637381" }}>
          {syncBlockedMessage}{" "}
          <Link to={billingHref} style={{ color: "#005bd3" }}>
            {en ? "View plans" : "查看套餐"}
          </Link>
        </p>
      )}

      {showPreview && !compact && (
        <div style={{ marginTop: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
            <strong>{en ? "Preview" : "预览"}</strong>
            {context !== "workspace" && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={handleCopy}
                  disabled={!canUseAdvanced || !previewText}
                  style={{
                    padding: "8px 12px",
                    border: "1px solid #c4cdd5",
                    borderRadius: 8,
                    background: "#fff",
                    cursor: !canUseAdvanced || !previewText ? "not-allowed" : "pointer",
                    opacity: !canUseAdvanced || !previewText ? 0.6 : 1,
                  }}
                >
                  {copied ? (en ? "Copied" : "已复制") : (en ? "Copy" : "复制")}
                </button>
                <a
                  href={downloadHref}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 8,
                    background: "#fff",
                    border: "1px solid #c4cdd5",
                    color: "#111827",
                    textDecoration: "none",
                    opacity: canUseAdvanced ? 1 : 0.6,
                  }}
                >
                  {en ? "Download llms.txt" : "下载 llms.txt"}
                </a>
              </div>
            )}
          </div>
          <textarea
            readOnly
            value={resolvedPreviewText}
            rows={12}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: 12,
              borderRadius: 10,
              border: "1px solid #e1e3e5",
              background: "#111827",
              color: "#f9fafb",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 12,
            }}
          />
          {!canUseAdvanced && (
            <p style={{ margin: "8px 0 0", color: "#637381" }}>
              {previewBlockedMessage}{" "}
              <Link to={billingHref} style={{ color: "#005bd3" }}>
                {en ? "Upgrade plan" : "升级套餐"}
              </Link>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
