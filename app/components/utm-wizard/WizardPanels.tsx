import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Banner, Button, Card, EmptyState, InfoCard, StatusBadge } from "../ui";

export const AI_SOURCES = [
  { id: "chatgpt", name: "ChatGPT", domain: "chat.openai.com", icon: "🤖" },
  { id: "perplexity", name: "Perplexity", domain: "perplexity.ai", icon: "🔍" },
  { id: "claude", name: "Claude", domain: "claude.ai", icon: "🧠" },
  { id: "gemini", name: "Google Gemini", domain: "gemini.google.com", icon: "✨" },
  { id: "copilot", name: "Microsoft Copilot", domain: "copilot.microsoft.com", icon: "💼" },
  { id: "bing", name: "Bing Chat", domain: "bing.com", icon: "🔎" },
] as const;

export type AISource = (typeof AI_SOURCES)[number];
export type AISourceId = AISource["id"];

function CopyButton({ text, en }: { text: string; en: boolean }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    }
  }, [text]);

  return (
    <Button
      type="button"
      onClick={handleCopy}
      size="small"
      style={copied ? { background: "#52c41a", borderColor: "#52c41a" } : undefined}
    >
      {copied ? (en ? "✓ Copied!" : "✓ 已复制！") : (en ? "Copy" : "复制")}
    </Button>
  );
}

export function SourceCard({
  source,
  storeUrl,
  productPath,
  en,
  isSelected,
  onSelect,
}: {
  source: AISource;
  storeUrl: string;
  productPath: string;
  en: boolean;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const { fullUrl, error } = useMemo(() => {
    try {
      const url = new URL(productPath.startsWith("/") ? productPath : `/${productPath}`, storeUrl);
      url.searchParams.set("utm_source", source.id);
      url.searchParams.set("utm_medium", "ai_assistant");
      url.searchParams.set("utm_campaign", "ai_referral");
      return { fullUrl: url.toString(), error: null };
    } catch {
      return { fullUrl: "", error: en ? "Invalid path" : "无效路径" };
    }
  }, [en, productPath, source.id, storeUrl]);

  return (
    <div onClick={onSelect} role="button" tabIndex={0} onKeyDown={(event) => (event.key === "Enter" || event.key === " ") && onSelect()}>
      <Card
        padding="tight"
        style={{
          border: isSelected ? "2px solid #008060" : "1px solid #e0e0e0",
          background: isSelected ? "#f6ffed" : "#fff",
          cursor: "pointer",
          transition: "all 0.2s",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 24 }}>{source.icon}</span>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{source.name}</div>
            <div style={{ fontSize: 12, color: "#637381" }}>{source.domain}</div>
          </div>
          {isSelected && (
            <StatusBadge tone="success" style={{ marginLeft: "auto", fontSize: 11 }}>
              {en ? "Selected" : "已选"}
            </StatusBadge>
          )}
        </div>

        {isSelected && (
          <div style={{ marginTop: 12 }}>
            {error ? (
              <div style={{ marginBottom: 12 }}>
                <Banner status="critical">{error}</Banner>
              </div>
            ) : (
              <>
                <Card padding="tight" style={{ background: "#f4f6f8", marginBottom: 12 }}>
                  <div style={{ fontSize: 12, wordBreak: "break-all", fontFamily: "monospace" }}>{fullUrl}</div>
                </Card>
                <CopyButton text={fullUrl} en={en} />
              </>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

function DetectionField({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: string;
}) {
  return (
    <Card padding="tight" style={{ background: "#f9fafb" }}>
      <div style={{ fontSize: 11, color: "#919eab", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
        {icon && <span>{icon}</span>}
        {value}
      </div>
    </Card>
  );
}

export function DetectionPreview({
  source,
  en,
}: {
  source: AISource | null;
  en: boolean;
}) {
  if (!source) {
    return (
      <EmptyState
        title={en ? "Select an AI source to preview detection" : "选择一个 AI 来源以预览检测结果"}
        icon="🔍"
        style={{ background: "transparent", border: "1px dashed #d9d9d9" }}
      />
    );
  }

  return (
    <div style={{ padding: 20 }}>
      <div style={{ marginBottom: 16 }}>
        <Banner status="success">{en ? "This link will be detected as:" : "此链接将被识别为："}</Banner>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <DetectionField label={en ? "AI Source" : "AI 来源"} value={source.name} icon={source.icon} />
        <DetectionField label="utm_source" value={source.id} />
        <DetectionField label="utm_medium" value="ai_assistant" />
        <DetectionField label="utm_campaign" value="ai_referral" />
      </div>

      <div style={{ marginTop: 16 }}>
        <Banner status="info">
          <strong>{en ? "Tip:" : "提示："}</strong>{" "}
          {en
            ? "When users click this link from AI assistants, orders are more likely to be attributed to the matching AI channel."
            : "当用户从 AI 助手点击此链接时，订单更容易被归因到对应的 AI 渠道。"}
        </Banner>
      </div>
    </div>
  );
}

export function BulkGenerator({
  storeUrl,
  en,
}: {
  storeUrl: string;
  en: boolean;
}) {
  const [paths, setPaths] = useState("/products/example-product");
  const [selectedSources, setSelectedSources] = useState<AISourceId[]>(["chatgpt", "perplexity"]);

  const { generatedLinks, errorPaths } = useMemo(() => {
    const pathList = paths.split("\n").filter((path) => path.trim());
    const links: string[] = [];
    const errors: string[] = [];

    for (const path of pathList) {
      for (const sourceId of selectedSources) {
        const source = AI_SOURCES.find((item) => item.id === sourceId);
        if (!source) continue;
        try {
          const trimmedPath = path.trim();
          const url = new URL(trimmedPath.startsWith("/") ? trimmedPath : `/${trimmedPath}`, storeUrl);
          url.searchParams.set("utm_source", source.id);
          url.searchParams.set("utm_medium", "ai_assistant");
          url.searchParams.set("utm_campaign", "ai_referral");
          links.push(`${source.name}: ${url.toString()}`);
        } catch {
          if (!errors.includes(path.trim())) errors.push(path.trim());
        }
      }
    }

    return {
      generatedLinks: links.join("\n"),
      errorPaths: errors,
    };
  }, [paths, selectedSources, storeUrl]);

  return (
    <div style={{ padding: 20 }}>
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", marginBottom: 8, fontWeight: 500, fontSize: 14 }}>
          {en ? "Product/Page Paths (one per line)" : "产品/页面路径（每行一个）"}
        </label>
        <textarea
          value={paths}
          onChange={(event) => setPaths(event.target.value)}
          placeholder="/products/product-handle&#10;/collections/sale&#10;/pages/about"
          style={{
            width: "100%",
            minHeight: 100,
            padding: 12,
            borderRadius: 6,
            border: "1px solid #c4cdd5",
            fontFamily: "monospace",
            fontSize: 13,
            resize: "vertical",
          }}
        />
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", marginBottom: 8, fontWeight: 500, fontSize: 14 }}>
          {en ? "AI Sources" : "AI 来源"}
        </label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} role="group" aria-label={en ? "Select AI sources" : "选择 AI 来源"}>
          {AI_SOURCES.map((source) => (
            <label
              key={source.id}
              htmlFor={`bulk-source-${source.id}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 12px",
                border: selectedSources.includes(source.id) ? "2px solid #008060" : "1px solid #e0e0e0",
                borderRadius: 6,
                cursor: "pointer",
                background: selectedSources.includes(source.id) ? "#f6ffed" : "#fff",
              }}
            >
              <input
                id={`bulk-source-${source.id}`}
                type="checkbox"
                checked={selectedSources.includes(source.id)}
                onChange={(event) => {
                  if (event.target.checked) {
                    setSelectedSources([...selectedSources, source.id]);
                  } else {
                    setSelectedSources(selectedSources.filter((id) => id !== source.id));
                  }
                }}
                style={{ display: "none" }}
                aria-label={source.name}
              />
              <span aria-hidden="true">{source.icon}</span>
              <span style={{ fontSize: 13 }}>{source.name}</span>
            </label>
          ))}
        </div>
      </div>

      {errorPaths.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <Banner status="critical" title={en ? "Invalid paths" : "无效路径"}>
            <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
              {errorPaths.map((path, index) => (
                <li key={index}>{path}</li>
              ))}
            </ul>
          </Banner>
        </div>
      )}

      {selectedSources.length === 0 && (
        <div style={{ marginBottom: 16 }}>
          <Banner status="warning">
            {en ? "Please select at least one AI source" : "请至少选择一个 AI 来源"}
          </Banner>
        </div>
      )}

      {generatedLinks && (
        <Card padding="tight">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <label style={{ fontWeight: 500, fontSize: 14 }}>
              {en ? "Generated Links" : "生成的链接"}
            </label>
            <CopyButton text={generatedLinks} en={en} />
          </div>
          <textarea
            value={generatedLinks}
            readOnly
            aria-label={en ? "Generated links output" : "生成的链接输出"}
            style={{
              width: "100%",
              minHeight: 150,
              padding: 12,
              borderRadius: 6,
              border: "1px solid #c4cdd5",
              fontFamily: "monospace",
              fontSize: 12,
              background: "#f9fafb",
              resize: "vertical",
            }}
          />
        </Card>
      )}
    </div>
  );
}

export function UsageCard({
  step,
  title,
  description,
}: {
  step: string;
  title: string;
  description: string;
}) {
  return (
    <InfoCard
      icon={
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: "#008060",
            color: "#fff",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          {step}
        </span>
      }
      title={title}
      description={description}
      accentColor="#008060"
      background="#f9fafb"
    />
  );
}
