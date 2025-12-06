import { useEffect, useMemo, useState, useCallback } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useNavigate, useLocation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import {
  channelList,
  resolveDateRange,
  type DateRange,
  type AIChannel,
  type AiDomainRule,
  type TimeRangeKey,
  type UtmSourceRule,
} from "../lib/aiData";
import { downloadFromApi } from "../lib/downloadUtils";
import { fetchOrdersForRange } from "../lib/shopifyOrders.server";
import { getSettings, markActivity, normalizeSettingsPayload, saveSettings, syncShopPreferences } from "../lib/settings.server";
import { buildLlmsTxt, updateLlmsTxtCache } from "../lib/llms.server";
import { getDeadLetterJobs, getWebhookQueueSize } from "../lib/webhookQueue.server";
import { persistOrders } from "../lib/persistence.server";
import { applyAiTags } from "../lib/tagging.server";
import { authenticate } from "../shopify.server";
import styles from "../styles/app.settings.module.css";
import { t } from "../lib/i18n";
import { getPlatform, isDemoMode } from "../lib/runtime.server";
import { readAppFlags } from "../lib/env.server";
import { LANGUAGE_EVENT, LANGUAGE_STORAGE_KEY, BACKFILL_COOLDOWN_MINUTES, DEFAULT_RANGE_KEY, MAX_BACKFILL_DURATION_MS, MAX_BACKFILL_ORDERS, MAX_BACKFILL_DAYS } from "../lib/constants";
import { loadDashboardContext } from "../lib/dashboardContext.server";
import { logger } from "../lib/logger.server";
import { hasFeature, FEATURES } from "../lib/access.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const _demo = isDemoMode();
  let admin, session;
  let authFailed = false;
  
  try {
    const auth = await authenticate.admin(request);
    admin = auth.admin;
    session = auth.session;
  } catch (error) {
    authFailed = true;
  }

  const url = new URL(request.url);
  const shopDomain = session?.shop || "";
  let settings = await getSettings(shopDomain);
  // Only use admin if authentication succeeded
  if (admin && shopDomain && !authFailed) {
    try {
      settings = await syncShopPreferences(admin, shopDomain, settings);
    } catch (e) {
      logger.warn("[settings] syncShopPreferences failed", { shopDomain }, { error: (e as Error).message });
    }
  }
  const exportRange = (url.searchParams.get("range") as TimeRangeKey) || "90d";

  const { orders, clamped, displayTimezone } = await loadDashboardContext({
    shopDomain,
    admin, // admin can be null
    settings,
    url,
    defaultRangeKey: (exportRange as TimeRangeKey) || DEFAULT_RANGE_KEY,
    fallbackToShopify: false,
    fallbackIntent: "settings-export",
  });
  

  const ordersSample = orders.slice(0, 20);
  const [webhookQueueSize, deadLetters, canExport] = await Promise.all([
    getWebhookQueueSize(),
    getDeadLetterJobs(10),
    hasFeature(shopDomain, FEATURES.EXPORTS),
  ]);
  const { showDebugPanels } = readAppFlags();
  return { settings, exportRange, clamped, displayTimezone, ordersSample, webhookQueueSize, deadLetters, canExport, showDebugPanels, shopDomain };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  let shopDomain = "";
  let admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"] | null = null;
  let session: Awaited<ReturnType<typeof authenticate.admin>>["session"] | null = null;
  
  try {
    const auth = await authenticate.admin(request);
    admin = auth.admin;
    session = auth.session;
    shopDomain = session?.shop || "";
  } catch (error) {
    if (!isDemoMode()) throw error;
    // Demo mode: shopDomain remains empty
  }

  try {
    const platform = getPlatform();
    const formData = await request.formData();
    const intent = formData.get("intent") || "save";
    const incoming = formData.get("settings");
    const currentSettings = await getSettings(shopDomain);
    const currentLanguage = currentSettings.languages && currentSettings.languages[0] ? currentSettings.languages[0] : "中文";

    if (!incoming) {
      throw new Error(currentLanguage === "English" ? "Missing settings payload" : "缺少设置数据载荷");
    }

    let normalized;
      try {
        normalized = normalizeSettingsPayload(incoming.toString());
      } catch (parseError) {
        return Response.json(
          { ok: false, message: currentLanguage === "English" ? "Invalid settings format. Please refresh and retry." : "设置格式无效，请刷新后重试" },
          { status: 400 },
        );
      }
    const existing = await getSettings(shopDomain);
    const merged = {
      ...existing,
      ...normalized,
      primaryCurrency: normalized.primaryCurrency || existing.primaryCurrency || "USD",
      languages:
        normalized.languages && normalized.languages.length ? normalized.languages : existing.languages,
      timezones:
        normalized.timezones && normalized.timezones.length ? normalized.timezones : existing.timezones,
      pipelineStatuses:
        normalized.pipelineStatuses && normalized.pipelineStatuses.length
          ? normalized.pipelineStatuses
          : existing.pipelineStatuses,
    };

    await saveSettings(shopDomain, merged);
    
    // Refresh llms.txt cache when exposure preferences may have changed
    if (admin && shopDomain) {
      try {
        const llmsText = await buildLlmsTxt(shopDomain, merged, {
          range: "30d",
          topN: 20,
          admin,
        });
        await updateLlmsTxtCache(shopDomain, llmsText);
      } catch (e) {
        // Non-blocking: log but don't fail the save operation
        logger.warn("[settings] Failed to refresh llms.txt cache", { shopDomain }, { error: (e as Error).message });
      }
    }
    
    const calculationTimezone = merged.timezones[0] || "UTC";
    const range: DateRange = resolveDateRange(
      "90d",
      new Date(),
      undefined,
      undefined,
      calculationTimezone,
    );
    const now = new Date();
    const lastBackfillAt = merged.lastBackfillAt ? new Date(merged.lastBackfillAt) : null;
    const withinCooldown =
      lastBackfillAt &&
      now.getTime() - lastBackfillAt.getTime() < BACKFILL_COOLDOWN_MINUTES * 60 * 1000;

    if (intent === "backfill") {
      if (withinCooldown) {
        return Response.json(
          { ok: false, message: currentLanguage === "English" ? "Backfill cooldown (<30 minutes). Reusing current data." : "距离上次补拉不足 30 分钟，已复用现有数据。" },
          { status: 429 },
        );
      }
      if (!admin) {
        return Response.json(
          { ok: false, message: currentLanguage === "English" ? "Authentication required for backfill" : "补拉操作需要认证" },
          { status: 401 },
        );
      }
      const { orders } = await fetchOrdersForRange(admin, range, merged, {
        shopDomain,
        intent: "settings-backfill",
        rangeLabel: range.label,
      });
      const result = await persistOrders(shopDomain, orders);
      await markActivity(shopDomain, { lastBackfillAt: new Date() });
      logger.info(
        "[backfill] settings-trigger completed",
        { platform, shopDomain, intent },
        {
          fetched: orders.length,
          created: result.created,
          updated: result.updated,
        },
      );
    }

    if (intent === "tag") {
      if (!admin) {
        return Response.json(
          { ok: false, message: currentLanguage === "English" ? "Authentication required for tagging" : "标签写入需要认证" },
          { status: 401 },
        );
      }
      const { orders } = await fetchOrdersForRange(admin, range, merged, {
        shopDomain,
        intent: "settings-tagging",
        rangeLabel: range.label,
      });
      const aiOrders = orders.filter((order) => order.aiSource);

      if (merged.tagging.writeOrderTags || merged.tagging.writeCustomerTags) {
        await applyAiTags(admin, aiOrders, merged, { shopDomain, intent: "settings-tagging" });
      }
      const result = await persistOrders(shopDomain, orders);
      await markActivity(shopDomain, { lastTaggingAt: new Date() });
      logger.info(
        "[tagging] settings-trigger completed",
        { platform, shopDomain, intent },
        {
          aiOrders: aiOrders.length,
          totalOrders: orders.length,
          created: result.created,
          updated: result.updated,
        },
      );
    }

    return Response.json({ ok: true, intent });
  } catch (error) {
    logger.error("Failed to save settings", { shopDomain }, {
      message: (error as Error).message,
    });
    return Response.json(
      { ok: false, message: (error as Error).message },
      { status: 400 },
    );
  }
};

type Lang = "English" | "中文";

const isValidDomain = (value: string) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value.trim());
const isValidUtmSource = (value: string) => /^[a-z0-9_-]+$/i.test(value.trim());

export default function SettingsAndExport() {
  const { settings, exportRange, clamped, ordersSample, webhookQueueSize, deadLetters, canExport, showDebugPanels, shopDomain } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();
  const location = useLocation();

  const [domains, setDomains] = useState<AiDomainRule[]>(settings.aiDomains);
  const [newDomain, setNewDomain] = useState("");
  const [newDomainChannel, setNewDomainChannel] = useState<AIChannel | "Other-AI">(
    "Other-AI",
  );

  const [utmMappings, setUtmMappings] = useState<UtmSourceRule[]>(settings.utmSources);
  const [newSource, setNewSource] = useState("");
  const [newSourceChannel, setNewSourceChannel] = useState<AIChannel | "Other-AI">(
    "Other-AI",
  );

  const [utmMediumInput, setUtmMediumInput] = useState(
    settings.utmMediumKeywords.join(", "),
  );

  const [tagging, setTagging] = useState(settings.tagging);
  const [exposurePreferences, setExposurePreferences] = useState(
    settings.exposurePreferences,
  );
  const [timezone, setTimezone] = useState(settings.timezones[0] || "UTC");
  // 先使用服务端的语言设置，避免 hydration 不匹配
  const [language, setLanguage] = useState<Lang>(settings.languages[0] as Lang);
  const [gmvMetric, setGmvMetric] = useState(settings.gmvMetric || "current_total_price");

  // 客户端挂载后从 localStorage 读取语言偏好并同步到 cookie
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
      if (stored === "English" || stored === "中文") {
        setLanguage(stored as Lang);
        // 同步到 cookie，确保后端可以读取
        document.cookie = `${LANGUAGE_STORAGE_KEY}=${encodeURIComponent(stored)};path=/;max-age=31536000`;
      }
    } catch { /* ignore */ }
  }, []);
  const [exportWindow, setExportWindow] = useState<TimeRangeKey>(exportRange as TimeRangeKey);

  // Modal state for confirming removal of default domain
  const [confirmModal, setConfirmModal] = useState<{ open: boolean; rule: AiDomainRule | null }>({ open: false, rule: null });

  // Track last save time to trigger llms.txt preview refresh
  const [lastSavedAt, setLastSavedAt] = useState<number>(0);

  // Modal state for confirming removal of default UTM rule
  const [confirmUtmModal, setConfirmUtmModal] = useState<{ open: boolean; rule: UtmSourceRule | null }>({ open: false, rule: null });

  const locale = language === "English" ? "en-US" : "zh-CN";

  const utmMediumKeywords = useMemo(
    () =>
      utmMediumInput
        .split(",")
        .map((keyword) => keyword.trim())
        .filter(Boolean),
    [utmMediumInput],
  );

  const sanitizedDomains = useMemo(() => {
    const seen = new Set<string>();
    return domains.filter((rule) => {
      const key = `${rule.domain}::${rule.channel}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [domains]);

  const sanitizedUtmSources = useMemo(() => {
    const seen = new Set<string>();
    return utmMappings.filter((rule) => {
      const key = rule.value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [utmMappings]);

  const addDomain = () => {
    if (!newDomain.trim()) return;
    if (!isValidDomain(newDomain)) {
      shopify.toast.show?.(language === "English" ? "Invalid domain format, e.g. chat.openai.com" : "域名格式不合法，请输入如 chat.openai.com");
      return;
    }
    const trimmed = newDomain.trim().toLowerCase();
    // Check for duplicate domain
    const exists = domains.some((rule) => rule.domain.toLowerCase() === trimmed);
    if (exists) {
      shopify.toast.show?.(language === "English" ? "This domain already exists in the list." : "该域名已存在于列表中。");
      return;
    }
    setDomains((prev) => [
      ...prev,
      { domain: newDomain.trim(), channel: newDomainChannel, source: "custom" },
    ]);
    setNewDomain("");
    shopify.toast.show?.(language === "English" ? "Custom AI domain added. Click Save to apply." : "已添加自定义 AI 域名，点击保存后生效");
  };

  const removeDomain = (rule: AiDomainRule) => {
    if (rule.source === "default") {
      // Show confirmation modal for default domains
      setConfirmModal({ open: true, rule });
      return;
    }
    setDomains((prev) =>
      prev.filter(
        (item) => !(item.domain === rule.domain && item.channel === rule.channel),
      ),
    );
  };

  const confirmRemoveDomain = () => {
    if (confirmModal.rule) {
      setDomains((prev) =>
        prev.filter(
          (item) => !(item.domain === confirmModal.rule!.domain && item.channel === confirmModal.rule!.channel),
        ),
      );
    }
    setConfirmModal({ open: false, rule: null });
  };

  const addUtmMapping = () => {
    if (!newSource.trim()) return;
    const value = newSource.trim().toLowerCase();
    if (!isValidUtmSource(value)) {
      shopify.toast.show?.(language === "English" ? "utm_source supports letters/numbers/dash/underscore only" : "utm_source 仅支持字母/数字/中划线/下划线");
      return;
    }
    // Check for duplicate utm_source
    const exists = utmMappings.some((rule) => rule.value.toLowerCase() === value);
    if (exists) {
      shopify.toast.show?.(language === "English" ? "This utm_source value already exists in the list." : "该 utm_source 值已存在于列表中。");
      return;
    }
    setUtmMappings((prev) => [...prev, { value, channel: newSourceChannel, source: "custom" }]);
    setNewSource("");
    shopify.toast.show?.(language === "English" ? "utm_source rule added. Save to apply to detection." : "新增 utm_source 规则，保存后应用到识别逻辑");
  };

  const removeUtmMapping = (rule: UtmSourceRule) => {
    // Show confirmation for default UTM rules
    if (rule.source === "default") {
      setConfirmUtmModal({ open: true, rule });
      return;
    }
    setUtmMappings((prev) => prev.filter((r) => r.value !== rule.value));
  };

  const confirmRemoveUtm = () => {
    if (confirmUtmModal.rule) {
      setUtmMappings((prev) => prev.filter((rule) => rule.value !== confirmUtmModal.rule!.value));
    }
    setConfirmUtmModal({ open: false, rule: null });
  };

  const handleDownload = useCallback(async (e: React.MouseEvent<HTMLAnchorElement | HTMLButtonElement>, url: string, fallbackFilename: string) => {
    e.preventDefault();
    // Check export permission
    if (!canExport) {
      shopify.toast.show?.(language === "English" ? "Upgrade to Pro to export data." : "升级到 Pro 版以导出数据。");
      return;
    }
    const success = await downloadFromApi(
      url,
      fallbackFilename,
      () => shopify.idToken()
    );
    if (!success) {
      shopify.toast.show?.(language === "English" ? "Download failed. Please try again." : "下载失败，请重试。");
    }
  }, [canExport, language, shopify]);

  const submitSettings = () => {
    const payload = {
      aiDomains: sanitizedDomains,
      utmSources: sanitizedUtmSources,
      utmMediumKeywords,
      gmvMetric,
      primaryCurrency: settings.primaryCurrency,
      tagging,
      exposurePreferences,
      languages: [language, ...settings.languages.filter((l) => l !== language)],
      timezones: [timezone, ...settings.timezones.filter((t) => t !== timezone)],
      pipelineStatuses: settings.pipelineStatuses,
    };

    fetcher.submit(
      { settings: JSON.stringify(payload) },
      { method: "post", encType: "application/x-www-form-urlencoded" },
    );
  };

  useEffect(() => {
    const data = fetcher.data as { ok: boolean; intent?: string; message?: string } | undefined;
    if (data) {
      if (data.ok) {
        const message =
          data.intent === "tag"
            ? (language === "English" ? "Tag write-back triggered (based on last 90 days AI orders)" : "标签写回已触发（基于最近 90 天 AI 订单）")
            : data.intent === "backfill"
              ? (language === "English" ? "Backfilled last 90 days (including AI detection)" : "已补拉最近 90 天订单（含 AI 识别）")
              : (language === "English" ? "Settings saved" : "设置已保存");
        shopify.toast.show?.(message);
        // Trigger llms.txt preview refresh after successful save
        setLastSavedAt(Date.now());
      } else {
        shopify.toast.show?.(
          data.message || (language === "English" ? "Save failed. Check configuration or retry later." : "保存失败，请检查配置或稍后重试"),
        );
      }
    }
  }, [fetcher.data, shopify, language]);

  return (
    <s-page heading={language === "English" ? "Settings / Rules & Export" : "设置 / 规则 & 导出"}>
      <div className={styles.page}>
      <div className={styles.lede}>
        <h1>{language === "English" ? "AI Channel Rules & Data Export" : "AI 渠道识别规则 & 数据导出"}</h1>
        <p>{t(language as Lang, "settings_lede_desc")}</p>
        <div className={styles.alert}>{t(language as Lang, "ai_conservative_alert")}</div>
        <p className={styles.helpText}>{t(language as Lang, "default_rules_help")}</p>
        <p className={styles.helpText}>{t(language as Lang, "tag_prefix_help")}</p>
        <div className={styles.inlineStats}>
          <span>
            {language === "English" ? "Last webhook: " : "最近 webhook："}
            {settings.lastOrdersWebhookAt
              ? new Date(settings.lastOrdersWebhookAt).toLocaleString(locale)
              : language === "English" ? "None" : "暂无"}
          </span>
          <span>
            {language === "English" ? "Last backfill: " : "最近补拉："}
            {settings.lastBackfillAt
              ? new Date(settings.lastBackfillAt).toLocaleString(locale)
              : language === "English" ? "None" : "暂无"}
          </span>
          <span>
            {language === "English" ? "Last tagging: " : "最近标签写回："}
            {settings.lastTaggingAt
              ? new Date(settings.lastTaggingAt).toLocaleString(locale)
              : language === "English" ? "None" : "暂无"}
          </span>
          <span>
            {language === "English" ? "Shop Currency: " : "店铺货币："}
            {settings.primaryCurrency || "USD"}
          </span>
          {clamped && (
            <span>
              {language === "English"
                ? "Hint: Export/Backfill is limited to the last 90 days."
                : "提示：导出/补拉已限制为最近 90 天内的订单窗口。"}
            </span>
          )}
        </div>
        <div className={styles.inlineActions}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() =>
              fetcher.submit(
                {
                  settings: JSON.stringify({
                    aiDomains: sanitizedDomains,
                    utmSources: sanitizedUtmSources,
                    utmMediumKeywords,
                    gmvMetric,
                    primaryCurrency: settings.primaryCurrency,
                    tagging,
                    exposurePreferences,
                    languages: [language, ...settings.languages.filter((l) => l !== language)],
                    timezones: [timezone, ...settings.timezones.filter((t) => t !== timezone)],
                    pipelineStatuses: settings.pipelineStatuses,
                  }),
                  intent: "backfill",
                },
                { method: "post", encType: "application/x-www-form-urlencoded" },
              )
            }
            data-action="settings-backfill"
          >{language === "English" ? "Backfill Last 90 Days" : "补拉最近 90 天订单"}</button>
        </div>
        <div className={styles.alert}>{t(language as Lang, "backfill_protect_alert")}</div>
        <p className={styles.helpText}>{t(language as Lang, "backfill_help")}</p>
      </div>

        <div className={styles.gridTwo}>
          <div className={styles.card}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.sectionLabel}>{t(language as Lang, "channels_section_label")}</p>
                <h3 className={styles.sectionTitle}>{language === "English" ? "Referrer Domains" : "Referrer 域名表"}</h3>
              </div>
              <span className={styles.badge}>{t(language as Lang, "badge_priority_high")}</span>
            </div>
            <div className={styles.ruleList}>
              {domains.map((rule) => (
                <div key={`${rule.domain}-${rule.channel}`} className={styles.ruleRow}>
                  <div>
                    <div className={styles.ruleTitle}>{rule.domain}</div>
                    <div className={styles.ruleMeta}>
                      {language === "English" ? "Channel: " : "渠道："}
                      {rule.channel} · {rule.source === "default" ? (language === "English" ? "Default" : "默认") : (language === "English" ? "Custom" : "自定义")}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={styles.linkButton}
                    title={rule.source === "default" ? t(language as Lang, "risk_remove_default_domain") : t(language as Lang, "title_delete_rule")}
                    onClick={() => removeDomain(rule)}
                    data-action="settings-remove-domain"
                  >
                    {t(language as Lang, "btn_delete")}
                  </button>
                </div>
              ))}
            </div>
            <div className={styles.addFormSection}>
              <p className={styles.addFormLabel}>
                {language === "English" ? "➕ Add Custom Domain" : "➕ 添加自定义域名"}
              </p>
              <div className={styles.inlineForm}>
                <div className={styles.formField}>
                  <label className={styles.fieldLabelSmall}>{language === "English" ? "Domain" : "域名"}</label>
                  <input
                    className={styles.input}
                    placeholder={language === "English" ? "e.g. chat.example.com" : "例如 chat.example.com"}
                    value={newDomain}
                    onChange={(event) => setNewDomain(event.target.value)}
                  />
                </div>
                <div className={styles.formField}>
                  <label className={styles.fieldLabelSmall}>{language === "English" ? "Channel" : "渠道"}</label>
                  <select
                    className={styles.select}
                    value={newDomainChannel}
                    onChange={(event) =>
                      setNewDomainChannel(event.target.value as AIChannel | "Other-AI")
                    }
                  >
                    {channelList.map((channel) => (
                      <option key={channel} value={channel}>
                        {channel}
                      </option>
                    ))}
                  </select>
                </div>
                <button type="button" className={styles.primaryButton} onClick={addDomain} data-action="settings-add-domain">
                  {t(language as Lang, "btn_add_domain")}
                </button>
              </div>
              <p className={styles.helpTextSmall}>
                {language === "English" 
                  ? "Enter a referrer domain to match AI traffic. The domain will be mapped to the selected channel."
                  : "输入来源域名以匹配 AI 流量，该域名将映射到所选渠道。"}
              </p>
            </div>
            <p className={styles.helpText}>{t(language as Lang, "referrer_help")}</p>
          </div>

          <div className={styles.card}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.sectionLabel}>{language === "English" ? "UTM Rules" : "UTM 匹配规则"}</p>
                <h3 className={styles.sectionTitle}>{language === "English" ? "utm_source → Channel Mapping" : "utm_source → 渠道映射"}</h3>
              </div>
              <span className={styles.badge}>{t(language as Lang, "badge_assist")}</span>
            </div>
            <div className={styles.ruleList}>
              {utmMappings.map((rule) => (
                <div key={`${rule.value}-${rule.channel}`} className={styles.ruleRow}>
                  <div>
                    <div className={styles.ruleTitle}>{rule.value}</div>
                    <div className={styles.ruleMeta}>
                      {language === "English" ? "Channel: " : "渠道："}
                      {rule.channel} · {rule.source === "default" ? (language === "English" ? "Default" : "默认") : (language === "English" ? "Custom" : "自定义")}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={styles.linkButton}
                    onClick={() => removeUtmMapping(rule)}
                    data-action="settings-remove-utm"
                  >
                    {t(language as Lang, "btn_delete")}
                  </button>
                </div>
              ))}
            </div>
            <div className={styles.addFormSection}>
              <p className={styles.addFormLabel}>
                {language === "English" ? "➕ Add UTM Source Rule" : "➕ 添加 UTM 来源规则"}
              </p>
              <div className={styles.inlineForm}>
                <div className={styles.formField}>
                  <label className={styles.fieldLabelSmall}>{language === "English" ? "utm_source value" : "utm_source 值"}</label>
                  <input
                    className={styles.input}
                    placeholder={language === "English" ? "e.g. chatgpt, perplexity" : "例如 chatgpt, perplexity"}
                    value={newSource}
                    onChange={(event) => setNewSource(event.target.value)}
                  />
                </div>
                <div className={styles.formField}>
                  <label className={styles.fieldLabelSmall}>{language === "English" ? "Channel" : "渠道"}</label>
                  <select
                    className={styles.select}
                    value={newSourceChannel}
                    onChange={(event) =>
                      setNewSourceChannel(event.target.value as AIChannel | "Other-AI")
                    }
                  >
                    {channelList.map((channel) => (
                      <option key={channel} value={channel}>
                        {channel}
                      </option>
                    ))}
                  </select>
                </div>
                <button type="button" className={styles.primaryButton} onClick={addUtmMapping} data-action="settings-add-utm">
                  {t(language as Lang, "btn_add_utm")}
                </button>
              </div>
              <p className={styles.helpTextSmall}>
                {language === "English" 
                  ? "Match orders by utm_source parameter. E.g., if utm_source=chatgpt, map to ChatGPT channel."
                  : "通过 utm_source 参数匹配订单。例如，当 utm_source=chatgpt 时，映射到 ChatGPT 渠道。"}
              </p>
            </div>
            <label className={styles.stackField}>
              <span className={styles.fieldLabel}>{language === "English" ? "utm_medium keywords (comma separated)" : "utm_medium 关键词（逗号分隔）"}</span>
              <input
                className={styles.input}
                value={utmMediumInput}
                onChange={(event) => setUtmMediumInput(event.target.value)}
              />
              <span className={styles.helpText}>{language === "English" ? "Current keywords: " : "当前关键词："}{utmMediumKeywords.join(", ") || (language === "English" ? "None" : "无")}</span>
            </label>
          </div>
        </div>

        <div className={styles.gridTwo}>
          <div className={styles.card}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.sectionLabel}>{language === "English" ? "Tag Write-back" : "标签写回"}</p>
                <h3 className={styles.sectionTitle}>{language === "English" ? "Control Shopify Tagging" : "控制 Shopify 标签行为"}</h3>
              </div>
              <div className={styles.inlineActions}>
                <button type="button" className={styles.secondaryButton} onClick={submitSettings} data-action="settings-save">
                  {t(language as Lang, "btn_save")}
                </button>
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={() =>
                    fetcher.submit(
                      {
                        settings: JSON.stringify({
                          aiDomains: sanitizedDomains,
                          utmSources: sanitizedUtmSources,
                          utmMediumKeywords,
                          gmvMetric,
                          primaryCurrency: settings.primaryCurrency,
                          tagging,
                          exposurePreferences,
                          languages: [language, ...settings.languages.filter((l) => l !== language)],
                          timezones: [timezone, ...settings.timezones.filter((t) => t !== timezone)],
                          pipelineStatuses: settings.pipelineStatuses,
                        }),
                        intent: "tag",
                      },
                      { method: "post", encType: "application/x-www-form-urlencoded" },
                    )
                  }
                  disabled={!tagging.writeOrderTags && !tagging.writeCustomerTags}
                  data-action="settings-tag-write"
                >
                  {t(language as Lang, "btn_write_tags_now")}
                </button>
              </div>
            </div>
            <div className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={tagging.writeOrderTags}
                onChange={(event) =>
                  setTagging((prev) => ({ ...prev, writeOrderTags: event.target.checked }))
                }
              />
              <div>
                <div className={styles.ruleTitle}>{language === "English" ? "Write AI channel tags to orders" : "向订单写回 AI 渠道标签"}</div>
                <div className={styles.ruleMeta}>
                  {language === "English" ? "Prefix: " : "前缀："}{tagging.orderTagPrefix}-ChatGPT / Perplexity / ...
                </div>
              </div>
            </div>
            <div className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={tagging.writeCustomerTags}
                onChange={(event) =>
                  setTagging((prev) => ({ ...prev, writeCustomerTags: event.target.checked }))
                }
              />
              <div>
                <div className={styles.ruleTitle}>{language === "English" ? "Write AI acquisition tag to customers" : "向客户写回 AI 获客标签"}</div>
                <div className={styles.ruleMeta}>{language === "English" ? "Example: " : "示例："}{tagging.customerTag}</div>
              </div>
            </div>
            <div className={styles.alert}>{t(language as Lang, "tagging_enable_alert")}</div>
            <label className={styles.stackField}>
              <span className={styles.fieldLabel}>{language === "English" ? "Order tag prefix" : "订单标签前缀"}</span>
              <input
                className={styles.input}
                value={tagging.orderTagPrefix}
                onChange={(event) =>
                  setTagging((prev) => ({ ...prev, orderTagPrefix: event.target.value }))
                }
              />
            </label>
            <label className={styles.stackField}>
              <span className={styles.fieldLabel}>{language === "English" ? "Customer tag" : "客户标签"}</span>
              <input
                className={styles.input}
                value={tagging.customerTag}
                onChange={(event) =>
                  setTagging((prev) => ({ ...prev, customerTag: event.target.value }))
                }
              />
            </label>
            <p className={styles.helpText}>{language === "English" ? "Tags are off by default; when enabled, they write to Shopify orders/customers for filtering/export." : "标签默认关闭；开启后会回写到 Shopify 订单/客户，便于在后台过滤或导出。"}</p>
          </div>

          <div className={styles.card}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.sectionLabel}>{language === "English" ? "llms.txt Preferences" : "llms.txt 偏好"}</p>
                <h3 className={styles.sectionTitle}>{language === "English" ? "Site Types to Expose to AI" : "希望向 AI 暴露的站点类型"}</h3>
              </div>
              <span className={styles.badge}>{t(language as Lang, "badge_experiment")}</span>
            </div>
            {shopDomain && (
              <div className={styles.alert} style={{ background: "#e3f1df", borderColor: "#50b83c" }}>
                {language === "English" ? "Public URL: " : "公开访问地址："}
                <a 
                  href={`https://${shopDomain}/a/llms`} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  style={{ color: "#006d3a", fontWeight: 500 }}
                >
                  https://{shopDomain}/a/llms
                </a>
                <span style={{ marginLeft: 8, color: "#637381", fontSize: 12 }}>
                  {language === "English" ? "(AI crawlers can access this URL)" : "（AI 爬虫可访问此地址）"}
                </span>
              </div>
            )}
            <p className={styles.helpText}>{language === "English" ? "Configure which content types AI crawlers (ChatGPT, Perplexity, etc.) can discover via llms.txt. Changes take effect after saving." : "配置 AI 爬虫（ChatGPT、Perplexity 等）可通过 llms.txt 发现哪些内容类型。更改保存后生效。"}</p>
            <div className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={exposurePreferences.exposeProducts}
                onChange={(event) =>
                  setExposurePreferences((prev) => ({
                    ...prev,
                    exposeProducts: event.target.checked,
                  }))
                }
              />
              <div>
                <div className={styles.ruleTitle}>{language === "English" ? "Allow AI to access product pages" : "允许 AI 访问产品页"}</div>
                <div className={styles.ruleMeta}>{language === "English" ? "product_url / handle" : "product_url / handle"}</div>
              </div>
            </div>
            <div className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={exposurePreferences.exposeCollections}
                onChange={(event) =>
                  setExposurePreferences((prev) => ({
                    ...prev,
                    exposeCollections: event.target.checked,
                  }))
                }
              />
              <div>
                <div className={styles.ruleTitle}>{language === "English" ? "Allow AI to access collections/categories" : "允许 AI 访问合集/分类页"}</div>
                <div className={styles.ruleMeta}>{language === "English" ? "Reserved for curated collections in future" : "未来用于生成精选集合"}</div>
              </div>
            </div>
            <div className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={exposurePreferences.exposeBlogs}
                onChange={(event) =>
                  setExposurePreferences((prev) => ({
                    ...prev,
                    exposeBlogs: event.target.checked,
                  }))
                }
              />
              <div>
                <div className={styles.ruleTitle}>{language === "English" ? "Allow AI to access blog content" : "允许 AI 访问博客内容"}</div>
                <div className={styles.ruleMeta}>{language === "English" ? "Blog/content pages optional" : "博客/内容页可选暴露"}</div>
              </div>
            </div>
          </div>

          <div className={styles.card}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.sectionLabel}>{language === "English" ? "llms.txt Preview" : "llms.txt 预览"}</p>
                <h3 className={styles.sectionTitle}>{language === "English" ? "Draft Based on Preferences" : "根据偏好生成草稿"}</h3>
              </div>
              <span className={styles.badge}>{t(language as Lang, "badge_experiment")}</span>
            </div>
            <LlmsPreview language={language} canExport={canExport} lastSavedAt={lastSavedAt} />
            <p className={styles.helpText}>{t(language as Lang, "llms_preview_help")}</p>
          </div>

          {/* 调试面板 - 仅在 SHOW_DEBUG_PANELS=true 时显示 */}
          {showDebugPanels && (
          <div className={styles.card}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.sectionLabel}>{language === "English" ? "Debug" : "调试"}</p>
                <h3 className={styles.sectionTitle}>{language === "English" ? "Recent Orders Diagnosis" : "最近订单诊断"}</h3>
              </div>
              <span className={styles.badge}>{language === "English" ? "Admin" : "仅管理员"}</span>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>{language === "English" ? "Order" : "订单"}</th>
                    <th>referrer</th>
                    <th>landing</th>
                    <th>utm_source</th>
                    <th>utm_medium</th>
                    <th>{language === "English" ? "AI" : "AI"}</th>
                    <th>{language === "English" ? "Detection" : "解析"}</th>
                  </tr>
                </thead>
                <tbody>
                  {(ordersSample || []).map((o) => (
                    <tr key={o.id}>
                      <td>{o.name}</td>
                      <td>{o.referrer || ""}</td>
                      <td>{o.landingPage || ""}</td>
                      <td>{o.utmSource || ""}</td>
                      <td>{o.utmMedium || ""}</td>
                      <td>{o.aiSource || ""}</td>
                      <td>{o.detection || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={styles.helpText}>{language === "English" ? "Only shows a small sample for debugging attribution signals; referrer has priority over UTM." : "用于调试 AI 渠道识别，仅展示少量样本；referrer 识别优先于 UTM。"}</p>
          </div>
          )}

          <div className={styles.card}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.sectionLabel}>{language === "English" ? "Language / Timezone" : "语言 / 时区"}</p>
                <h3 className={styles.sectionTitle}>{language === "English" ? "Display Preferences & GMV Metric" : "展示偏好 & GMV 口径"}</h3>
              </div>
              <span className={styles.badge}>{t(language as Lang, "badge_ui_only")}</span>
            </div>
            <label className={styles.stackField}>
              <span className={styles.fieldLabel}>{language === "English" ? "Language" : "语言"}</span>
              <select
                className={styles.select}
                value={language}
                onChange={(event) => {
                  const next = event.target.value as Lang;
                  setLanguage(next);
                  // 更新本地存储和派发事件以立即更新 UI
                  try { window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next); } catch { void 0; }
                  // 同时保存到 cookie，以便后端可以读取
                  try { document.cookie = `${LANGUAGE_STORAGE_KEY}=${encodeURIComponent(next)};path=/;max-age=31536000`; } catch { void 0; }
                  try { window.dispatchEvent(new CustomEvent(LANGUAGE_EVENT, { detail: next })); } catch { void 0; }
                  // 注意：语言变更不再自动提交到服务器，需要用户点击"保存"按钮
                }}
              >
                {settings.languages.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <span className={styles.helpText}>
                {language === "English"
                  ? "Language change takes effect immediately in UI. Click Save to persist to server."
                  : "语言更改立即在界面生效。点击“保存”按钮以持久化到服务器。"}
              </span>
            </label>
            <label className={styles.stackField}>
              <span className={styles.fieldLabel}>{language === "English" ? "Timezone" : "时区"}</span>
              <select
                className={styles.select}
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
              >
                {settings.timezones.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.stackField}>
              <span className={styles.fieldLabel}>{language === "English" ? "GMV Metric" : "GMV 口径"}</span>
              <select
                className={styles.select}
                value={gmvMetric}
                onChange={(event) =>
                  setGmvMetric(
                    event.target.value === "subtotal_price"
                      ? "subtotal_price"
                      : "current_total_price",
                  )
                }
              >
                <option value="current_total_price">{language === "English" ? "current_total_price (includes taxes/shipping)" : "current_total_price（含税/运费）"}</option>
                <option value="subtotal_price">{language === "English" ? "subtotal_price (excludes taxes/shipping)" : "subtotal_price（不含税/运费）"}</option>
              </select>
            </label>
            <p className={styles.helpText}>{t(language as Lang, "gmv_metric_help")}</p>
          </div>
        </div>

          <div className={styles.card}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.sectionLabel}>{language === "English" ? "Data Export" : "数据导出"}</p>
                <h3 className={styles.sectionTitle}>{language === "English" ? "CSV Download" : "CSV 下载"}</h3>
              </div>
              <span className={styles.badge}>{t(language as Lang, "badge_analysis")}</span>
            </div>
            <div className={styles.inlineForm}>
              <label className={styles.fieldLabel}>{language === "English" ? "Export Range" : "导出时间范围"}</label>
            <select
              className={styles.select}
              value={exportWindow}
              onChange={(event) => {
                const value = event.target.value as TimeRangeKey;
                setExportWindow(value);
                const params = new URLSearchParams(location.search);
                params.set("range", value);
                navigate({ search: `?${params.toString()}` });
              }}
            >
              <option value="30d">{language === "English" ? "Last 30 days" : "最近 30 天"}</option>
              <option value="90d">{language === "English" ? "Last 90 days" : "最近 90 天"}</option>
            </select>
            <span className={styles.helpText}>{language === "English" ? "Switch the range to regenerate exports." : "切换后将重新加载并生成对应区间的导出。"}</span>
          </div>
          {!canExport && (
            <div className={styles.alert} style={{ marginBottom: 12 }}>
              {language === "English" 
                ? "⚡ Export features require a Pro subscription. Upgrade to download CSV files."
                : "⚡ 导出功能需要 Pro 订阅。升级后可下载 CSV 文件。"}
            </div>
          )}
          <div className={styles.exportGrid}>
          <div className={styles.exportCard}>
            <h4>{language === "English" ? "AI Orders Details" : "AI 渠道订单明细"}</h4>
            <p>
              {language === "English"
                ? "Fields: order name, time, AI channel, GMV (per current metric), referrer, landing_page, source_name, utm_source, utm_medium, detection (with order_id/customer_id/new_customer for comparison)."
                : "字段：订单号、下单时间、AI 渠道、GMV（按当前 GMV 口径）、referrer、landing_page、source_name、utm_source、utm_medium、解析结果（附加 order_id / customer_id / new_customer 标记便于对照）。"}
            </p>
            <a
              className={styles.primaryButton}
              href={canExport ? `/api/export/orders?range=${exportWindow}` : "#"}
              onClick={(e) => handleDownload(e, `/api/export/orders?range=${exportWindow}`, `ai-orders-${exportWindow}.csv`)}
              style={!canExport ? { opacity: 0.6, cursor: "not-allowed" } : {}}
            >
              {language === "English" ? "Download CSV" : "下载 CSV"}
            </a>
          </div>
          <div className={styles.exportCard}>
            <h4>{t(language as Lang, "products_section_title")}</h4>
            <p>{language === "English" ? "Fields: product title, AI orders, AI GMV, AI share, top channel, URL (with product ID/handle for analysis)." : "字段：产品名、AI 订单数、AI GMV、AI 占比、Top 渠道、URL（附产品 ID / handle 便于二次分析）。"}</p>
            <a
              className={styles.secondaryButton}
              href={canExport ? `/api/export/products?range=${exportWindow}` : "#"}
              onClick={(e) => handleDownload(e, `/api/export/products?range=${exportWindow}`, `ai-products-${exportWindow}.csv`)}
              style={!canExport ? { opacity: 0.6, cursor: "not-allowed" } : {}}
            >
              {language === "English" ? "Download CSV" : "下载 CSV"}
            </a>
          </div>
          <div className={styles.exportCard}>
            <h4>{language === "English" ? "Customers LTV (Window)" : "Customers LTV（选定窗口）"}</h4>
            <p>{t(language as Lang, "customers_ltv_desc")}</p>
            <a
              className={styles.secondaryButton}
              href={canExport ? `/api/export/customers?range=${exportWindow}` : "#"}
              onClick={(e) => handleDownload(e, `/api/export/customers?range=${exportWindow}`, `customers-ltv-${exportWindow}.csv`)}
              style={!canExport ? { opacity: 0.6, cursor: "not-allowed" } : {}}
            >
              {language === "English" ? "Download CSV" : "下载 CSV"}
            </a>
          </div>
          </div>
          <p className={styles.helpText}>
            {language === "English"
              ? "Exports include only orders identified as AI-channel. If sample size is low, extend the time window before exporting. GMV column respects the selected GMV metric."
              : "导出仅包含已被识别的 AI 渠道订单；若 AI 样本量很低，建议延长时间窗口后再导出。导出的 GMV 字段随「GMV 口径」设置切换。"}
          </p>
        </div>

        <div className={styles.card}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.sectionLabel}>{language === "English" ? "Data Collection Health" : "数据采集健康度"}</p>
              <h3 className={styles.sectionTitle}>{language === "English" ? "Webhook / Backfill / Tagging" : "Webhook / Backfill / 标签写回"}</h3>
            </div>
            <span className={styles.badge}>{language === "English" ? "Monitor" : "监控"}</span>
          </div>
          <div className={styles.statusList}>
            {settings.pipelineStatuses.map((item) => {
              // 国际化翻译映射
              const titleMap: Record<string, string> = {
                "orders/create webhook": language === "English" ? "orders/create webhook" : "订单创建 Webhook",
                "Hourly backfill (last 90 days)": language === "English" ? "Hourly backfill (last 90 days)" : "每小时补拉（最近 90 天）",
                "AI tagging write-back": language === "English" ? "AI tagging write-back" : "AI 标签回写",
              };
              const statusMap: Record<string, string> = {
                healthy: language === "English" ? "HEALTHY" : "正常",
                warning: language === "English" ? "WARNING" : "警告",
                info: language === "English" ? "INFO" : "信息",
              };
              // 翻译 detail 中的常见英文片段
              const translateDetail = (detail: string): string => {
                if (language === "English") return detail;
                return detail
                  .replace(/Delivered (\d+) minutes? ago/g, "$1 分钟前送达")
                  .replace(/Delivered (\d+) hours? ago/g, "$1 小时前送达")
                  .replace(/Delivered (\d+) days? ago/g, "$1 天前送达")
                  .replace(/auto-retries enabled/g, "已启用自动重试")
                  .replace(/Catching up 90d orders to avoid webhook gaps/g, "补拉 90 天订单以避免 Webhook 漏单")
                  .replace(/Catching up 90d orders/g, "补拉 90 天订单")
                  .replace(/Order \+ customer tags ready/g, "订单和客户标签已就绪")
                  .replace(/off by default/g, "默认关闭")
                  .replace(/Waiting for first webhook/g, "等待首次 Webhook")
                  .replace(/Waiting for first backfill/g, "等待首次补拉")
                  .replace(/Last completed at/g, "上次完成于")
                  .replace(/Last completed/g, "上次完成")
                  .replace(/Last run at/g, "上次运行于")
                  .replace(/Last run/g, "上次运行")
                  .replace(/Processed/g, "已处理")
                  .replace(/in-flight/g, "处理中")
                  .replace(/Queued/g, "已入队")
                  .replace(/(\d+) orders/g, "$1 条订单")
                  .replace(/Failed at/g, "失败于")
                  .replace(/Tagging failed/g, "标签写入失败")
                  .replace(/check server logs and retry later/g, "请检查日志后重试")
                  .replace(/check logs/g, "请检查日志");
              };
              const displayTitle = titleMap[item.title] || item.title;
              const displayStatus = statusMap[item.status] || item.status;
              const displayDetail = translateDetail(item.detail);
              return (
                <div key={item.title} className={styles.statusRow}>
                  <div>
                    <div className={styles.ruleTitle}>{displayTitle}</div>
                    <div className={styles.ruleMeta}>{displayDetail}</div>
                  </div>
                  <span className={`${styles.statusBadge} ${item.status === "healthy" ? styles.statusHealthy : item.status === "warning" ? styles.statusWarning : styles.statusInfo}`}>{displayStatus}</span>
                </div>
              );
            })}
            <div className={styles.statusRow}>
              <div>
                <div className={styles.ruleTitle}>{language === "English" ? "Webhook Queue Size" : "Webhook 队列长度"}</div>
                <div className={styles.ruleMeta}>{webhookQueueSize}</div>
              </div>
              <span className={`${styles.statusBadge} ${webhookQueueSize > 0 ? styles.statusInfo : styles.statusHealthy}`}>{webhookQueueSize > 0 ? (language === "English" ? "pending" : "待处理") : (language === "English" ? "idle" : "空闲")}</span>
            </div>
          </div>
          {deadLetters && deadLetters.length > 0 && (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>{language === "English" ? "Shop" : "店铺"}</th>
                    <th>{language === "English" ? "Intent" : "意图"}</th>
                    <th>{language === "English" ? "Topic" : "主题"}</th>
                    <th>{language === "English" ? "Error" : "错误"}</th>
                    <th>{language === "English" ? "Finished" : "完成时间"}</th>
                  </tr>
                </thead>
                <tbody>
                  {deadLetters.map((j) => (
                    <tr key={j.id}>
                      <td>{j.shopDomain}</td>
                      <td>{j.intent}</td>
                      <td>{j.topic}</td>
                      <td>{j.error || ""}</td>
                      <td>{j.finishedAt ? new Date(j.finishedAt).toLocaleString(locale) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className={styles.helpText}>
            {language === "English"
              ? `Backfill limits: days=${MAX_BACKFILL_DAYS}, orders=${MAX_BACKFILL_ORDERS}, duration=${MAX_BACKFILL_DURATION_MS}ms.`
              : `补拉限制：天数=${MAX_BACKFILL_DAYS}，订单数=${MAX_BACKFILL_ORDERS}，时长=${MAX_BACKFILL_DURATION_MS}ms。`}
          </p>
          <p className={styles.helpText}>
            {language === "English" 
              ? "Webhook and scheduled backfill are enabled by default to avoid data gaps; tag write-back requires enabling in the \"Tag Write-back\" section above." 
              : "Webhook 和定时补拉已默认开启，确保数据完整；标签回写功能需要在上方「标签写回」中手动开启。"}
          </p>
        </div>
      </div>

      {/* Confirmation Modal for removing default domain */}
      {confirmModal.open && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(0, 0, 0, 0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000
        }}>
          <div style={{
            background: "white",
            borderRadius: 12,
            padding: 24,
            maxWidth: 400,
            width: "90%",
            boxShadow: "0 4px 24px rgba(0, 0, 0, 0.15)"
          }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 600 }}>
              {language === "English" ? "Confirm Removal" : "确认删除"}
            </h3>
            <p style={{ margin: "0 0 20px", color: "#555", lineHeight: 1.5 }}>
              {language === "English"
                ? "Removing a default domain may reduce attribution accuracy. Are you sure?"
                : "删除默认域名可能导致漏标，确定要移除这一项吗？"}
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setConfirmModal({ open: false, rule: null })}
                style={{
                  padding: "8px 16px",
                  borderRadius: 6,
                  border: "1px solid #ccc",
                  background: "white",
                  cursor: "pointer",
                  fontSize: 14
                }}
              >
                {language === "English" ? "Cancel" : "取消"}
              </button>
              <button
                type="button"
                onClick={confirmRemoveDomain}
                style={{
                  padding: "8px 16px",
                  borderRadius: 6,
                  border: "none",
                  background: "#d72c0d",
                  color: "white",
                  cursor: "pointer",
                  fontSize: 14
                }}
              >
                {language === "English" ? "Remove" : "删除"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal for removing default UTM rule */}
      {confirmUtmModal.open && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(0, 0, 0, 0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000
        }}>
          <div style={{
            background: "white",
            borderRadius: 12,
            padding: 24,
            maxWidth: 400,
            width: "90%",
            boxShadow: "0 4px 24px rgba(0, 0, 0, 0.15)"
          }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 600 }}>
              {language === "English" ? "Confirm Removal" : "确认删除"}
            </h3>
            <p style={{ margin: "0 0 20px", color: "#555", lineHeight: 1.5 }}>
              {language === "English"
                ? `Removing the default UTM rule "${confirmUtmModal.rule?.value}" may reduce attribution accuracy. Are you sure?`
                : `删除默认 UTM 规则「${confirmUtmModal.rule?.value}」可能导致漏标，确定要移除吗？`}
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setConfirmUtmModal({ open: false, rule: null })}
                style={{
                  padding: "8px 16px",
                  borderRadius: 6,
                  border: "1px solid #ccc",
                  background: "white",
                  cursor: "pointer",
                  fontSize: 14
                }}
              >
                {language === "English" ? "Cancel" : "取消"}
              </button>
              <button
                type="button"
                onClick={confirmRemoveUtm}
                style={{
                  padding: "8px 16px",
                  borderRadius: 6,
                  border: "none",
                  background: "#d72c0d",
                  color: "white",
                  cursor: "pointer",
                  fontSize: 14
                }}
              >
                {language === "English" ? "Remove" : "删除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

function LlmsPreview({ language, canExport, lastSavedAt }: { language: string; canExport: boolean; lastSavedAt?: number }) {
  const shopify = useAppBridge();
  const fetcher = useFetcher<{ ok: boolean; text: string }>();
  const [copied, setCopied] = useState(false);

  const handleDownload = useCallback(async (e: React.MouseEvent<HTMLAnchorElement>, url: string, fallbackFilename: string) => {
    e.preventDefault();
    if (!canExport) {
      shopify.toast.show?.(language === "English" ? "Upgrade to Pro to download." : "升级到 Pro 版以下载。");
      return;
    }
    const success = await downloadFromApi(
      url,
      fallbackFilename,
      () => shopify.idToken()
    );
    if (!success) {
      shopify.toast.show?.(language === "English" ? "Download failed" : "下载失败");
    }
  }, [canExport, language, shopify]);

  useEffect(() => {
    // Only load if user has export permission to avoid 403 errors
    if (canExport) {
      // Pass current language to API to ensure preview matches UI language selection
      fetcher.load(`/api/llms-txt-preview?ts=${Date.now()}&lang=${encodeURIComponent(language)}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, canExport, lastSavedAt]);

  const upgradeMessage = language === "English" 
    ? "# Upgrade to Pro to preview llms.txt\n\nThis feature requires a Pro subscription."
    : "# 升级到 Pro 版以预览 llms.txt\n\n此功能需要 Pro 订阅。";
  
  const text = !canExport 
    ? upgradeMessage 
    : (fetcher.data?.text || (language === "English" ? "# Generating..." : "# 生成中..."));

  const copy = async () => {
    if (!canExport) {
      shopify.toast.show?.(language === "English" ? "Upgrade to Pro to copy." : "升级到 Pro 版以复制。");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { void 0; }
  };

  return (
    <div>
      <textarea readOnly className={styles.textarea} value={text} rows={10} style={!canExport ? { opacity: 0.6 } : {}} />
      <div className={styles.inlineActions}>
        <button type="button" className={styles.secondaryButton} onClick={copy} data-action="llms-copy">
          {copied ? (language === "English" ? "Copied" : "已复制") : (language === "English" ? "Copy" : "复制")}
        </button>
        <a 
          href={canExport ? "/api/llms-txt-preview?download=1" : "#"}
          className={styles.primaryButton}
          onClick={(e) => handleDownload(e, "/api/llms-txt-preview?download=1", "llms.txt")}
          style={!canExport ? { opacity: 0.6 } : {}}
        >
          {language === "English" ? "Download llms.txt" : "下载 llms.txt"}
        </a>
      </div>
    </div>
  );
}
