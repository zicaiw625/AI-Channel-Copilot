import { useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useNavigate, useLocation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import {
  buildDashboardData,
  buildDashboardFromOrders,
  channelList,
  resolveDateRange,
  type DateRange,
  type AIChannel,
  type AiDomainRule,
  type TimeRangeKey,
  type UtmSourceRule,
} from "../lib/aiData";
import { fetchOrdersForRange } from "../lib/shopifyOrders.server";
import {
  getSettings,
  markActivity,
  normalizeSettingsPayload,
  saveSettings,
  syncShopPreferences,
} from "../lib/settings.server";
import { persistOrders } from "../lib/persistence.server";
import { applyAiTags } from "../lib/tagging.server";
import { authenticate } from "../shopify.server";
import styles from "../styles/app.settings.module.css";
import { t } from "../lib/i18n";
import { allowDemoData, getPlatform } from "../lib/runtime.server";
import { loadDashboardContext } from "../lib/dashboardContext.server";
import {
  BACKFILL_COOLDOWN_MINUTES,
  DEFAULT_RANGE_KEY,
  MAX_BACKFILL_DURATION_MS,
  MAX_BACKFILL_ORDERS,
} from "../lib/constants";
import { logger } from "../lib/logger.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const shopDomain = session?.shop || "";
  let settings = await getSettings(shopDomain);
  settings = await syncShopPreferences(admin, shopDomain, settings);
  const exportRange = (url.searchParams.get("range") as TimeRangeKey) || "90d";
  const demoAllowed = allowDemoData();

  const { dateRange, orders, clamped, displayTimezone } = await loadDashboardContext({
    shopDomain,
    admin,
    settings,
    url,
    defaultRangeKey: (exportRange as TimeRangeKey) || DEFAULT_RANGE_KEY,
    fallbackToShopify: true,
    fallbackIntent: "settings-export",
  });

  const exports = orders.length
    ? buildDashboardFromOrders(
        orders,
        dateRange,
        settings.gmvMetric,
        displayTimezone,
        settings.primaryCurrency,
      ).exports
    : demoAllowed
      ? buildDashboardData(dateRange, settings.gmvMetric, displayTimezone, settings.primaryCurrency).exports
      : buildDashboardFromOrders(
          [],
          dateRange,
          settings.gmvMetric,
          displayTimezone,
          settings.primaryCurrency,
        ).exports;

  return { settings, exports, exportRange, clamped, displayTimezone };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  let shopDomain = "";
  try {
    const { session, admin } = await authenticate.admin(request);
    shopDomain = session?.shop || "";
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

const toCsvHref = (content: string) =>
  `data:text/csv;charset=utf-8,${encodeURIComponent(content)}`;

const isValidDomain = (value: string) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value.trim());
const isValidUtmSource = (value: string) => /^[a-z0-9_-]+$/i.test(value.trim());

export default function SettingsAndExport() {
  const { settings, exports, exportRange, clamped } = useLoaderData<typeof loader>();
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
  const [language, setLanguage] = useState(settings.languages[0]);
  const [gmvMetric, setGmvMetric] = useState(settings.gmvMetric || "current_total_price");
  const [exportWindow, setExportWindow] = useState<TimeRangeKey>(exportRange as TimeRangeKey);

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
    setDomains((prev) => [
      ...prev,
      { domain: newDomain.trim(), channel: newDomainChannel, source: "custom" },
    ]);
    setNewDomain("");
    shopify.toast.show?.(language === "English" ? "Custom AI domain added. Click Save to apply." : "已添加自定义 AI 域名，点击保存后生效");
  };

  const removeDomain = (rule: AiDomainRule) => {
    if (
      rule.source === "default" &&
      !window.confirm(language === "English" ? "Removing a default domain may reduce attribution accuracy. Are you sure?" : "删除默认域名可能导致漏标，确定要移除这一项吗？")
    ) {
      return;
    }
    setDomains((prev) =>
      prev.filter(
        (item) => !(item.domain === rule.domain && item.channel === rule.channel),
      ),
    );
  };

  const addUtmMapping = () => {
    if (!newSource.trim()) return;
    const value = newSource.trim().toLowerCase();
    if (!isValidUtmSource(value)) {
      shopify.toast.show?.(language === "English" ? "utm_source supports letters/numbers/dash/underscore only" : "utm_source 仅支持字母/数字/中划线/下划线");
      return;
    }
    setUtmMappings((prev) => [...prev, { value, channel: newSourceChannel }]);
    setNewSource("");
    shopify.toast.show?.(language === "English" ? "utm_source rule added. Save to apply to detection." : "新增 utm_source 规则，保存后应用到识别逻辑");
  };

  const removeUtmMapping = (value: string) => {
    setUtmMappings((prev) => prev.filter((rule) => rule.value !== value));
  };

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
    if (fetcher.data) {
      if (fetcher.data.ok) {
        const message =
          fetcher.data.intent === "tag"
            ? (language === "English" ? "Tag write-back triggered (based on last 90 days AI orders)" : "标签写回已触发（基于最近 90 天 AI 订单）")
            : fetcher.data.intent === "backfill"
              ? (language === "English" ? "Backfilled last 90 days (including AI detection)" : "已补拉最近 90 天订单（含 AI 识别）")
              : (language === "English" ? "Settings saved" : "设置已保存");
        shopify.toast.show?.(message);
      } else {
        shopify.toast.show?.(
          fetcher.data.message || (language === "English" ? "Save failed. Check configuration or retry later." : "保存失败，请检查配置或稍后重试"),
        );
      }
    }
  }, [fetcher.data, shopify]);

  return (
    <s-page heading={language === "English" ? "Settings / Rules & Export" : "设置 / 规则 & 导出"}>
      <div className={styles.page}>
      <div className={styles.lede}>
        <h1>{language === "English" ? "AI Channel Rules & Data Export" : "AI 渠道识别规则 & 数据导出"}</h1>
        <p>{t(language as any, "settings_lede_desc")}</p>
        <div className={styles.alert}>{t(language as any, "ai_conservative_alert")}</div>
        <p className={styles.helpText}>{t(language as any, "default_rules_help")}</p>
        <p className={styles.helpText}>{t(language as any, "tag_prefix_help")}</p>
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
              : language === "English" ? "None / Simulated" : "暂无 / 模拟"}
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
          >{language === "English" ? "Backfill Last 90 Days" : "补拉最近 90 天订单"}</button>
        </div>
        <div className={styles.alert}>{t(language as any, "backfill_protect_alert")}</div>
        <p className={styles.helpText}>{t(language as any, "backfill_help")}</p>
      </div>

        <div className={styles.gridTwo}>
          <div className={styles.card}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.sectionLabel}>{t(language as any, "channels_section_label")}</p>
                <h3 className={styles.sectionTitle}>{language === "English" ? "Referrer Domains" : "Referrer 域名表"}</h3>
              </div>
              <span className={styles.badge}>{t(language as any, "badge_priority_high")}</span>
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
                    title={rule.source === "default" ? t(language as any, "risk_remove_default_domain") : t(language as any, "title_delete_rule")}
                    onClick={() => removeDomain(rule)}
                  >
                    {t(language as any, "btn_delete")}
                  </button>
                </div>
              ))}
            </div>
            <div className={styles.inlineForm}>
              <input
                className={styles.input}
                placeholder={t(language as any, "placeholder_add_domain")}
                value={newDomain}
                onChange={(event) => setNewDomain(event.target.value)}
              />
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
              <button type="button" className={styles.primaryButton} onClick={addDomain}>
                {t(language as any, "btn_add_domain")}
              </button>
            </div>
            <p className={styles.helpText}>{t(language as any, "referrer_help")}</p>
          </div>

          <div className={styles.card}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.sectionLabel}>{language === "English" ? "UTM Rules" : "UTM 匹配规则"}</p>
                <h3 className={styles.sectionTitle}>{language === "English" ? "utm_source → Channel Mapping" : "utm_source → 渠道映射"}</h3>
              </div>
              <span className={styles.badge}>{t(language as any, "badge_assist")}</span>
            </div>
            <div className={styles.ruleList}>
              {utmMappings.map((rule) => (
                <div key={`${rule.value}-${rule.channel}`} className={styles.ruleRow}>
                  <div>
                    <div className={styles.ruleTitle}>{rule.value}</div>
                    <div className={styles.ruleMeta}>{language === "English" ? "Channel: " : "渠道："}{rule.channel}</div>
                  </div>
                  <button
                    type="button"
                    className={styles.linkButton}
                    onClick={() => removeUtmMapping(rule.value)}
                  >
                    {t(language as any, "btn_delete")}
                  </button>
                </div>
              ))}
            </div>
            <div className={styles.inlineForm}>
              <input
                className={styles.input}
                placeholder={language === "English" ? "Add utm_source, e.g. ai-referral" : "新增 utm_source，例如 ai-referral"}
                value={newSource}
                onChange={(event) => setNewSource(event.target.value)}
              />
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
              <button type="button" className={styles.primaryButton} onClick={addUtmMapping}>
                {t(language as any, "btn_add_utm")}
              </button>
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
                <button type="button" className={styles.secondaryButton} onClick={submitSettings}>
                  {language === "English" ? "Save" : "保存"}
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
                >
                  {language === "English" ? "Write Tags Now" : "立即写回标签"}
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
            <div className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={!tagging.dryRun}
                onChange={(event) =>
                  setTagging((prev) => ({ ...prev, dryRun: !event.target.checked }))
                }
              />
              <div>
                <div className={styles.ruleTitle}>{language === "English" ? "Write to Shopify (unchecked = simulate)" : "实际写入 Shopify（关闭则为模拟）"}</div>
                <div className={styles.ruleMeta}>
                  {language === "English" ? "Default is dry-run to avoid mistakes; uncheck to actually write order/customer tags." : "默认模拟模式避免误写；取消选中后才会真正写入订单/客户标签。"}
                </div>
              </div>
            </div>
            <div className={styles.alert}>{t(language as any, "tagging_enable_alert")}</div>
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
                <p className={styles.sectionLabel}>{language === "English" ? "llms.txt Preferences (Reserved)" : "llms.txt 偏好（预留）"}</p>
                <h3 className={styles.sectionTitle}>{language === "English" ? "Site Types to Expose" : "希望向 AI 暴露的站点类型"}</h3>
              </div>
              <span className={styles.badge}>{t(language as any, "badge_experiment")}</span>
            </div>
            <p className={styles.helpText}>{language === "English" ? "Preferences only; no changes to storefront. Future llms.txt generation will respect these. Default off to avoid unnecessary exposure." : "仅存储偏好，不会改动店铺页面。未来生成 llms.txt 时会参考此配置；默认全部关闭以避免暴露不必要的内容。"}</p>
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
              <span className={styles.badge}>{t(language as any, "badge_experiment")}</span>
            </div>
            <LlmsPreview language={language} />
            <p className={styles.helpText}>{t(language as any, "llms_preview_help")}</p>
          </div>

          <div className={styles.card}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.sectionLabel}>{language === "English" ? "Language / Timezone" : "语言 / 时区"}</p>
                <h3 className={styles.sectionTitle}>{language === "English" ? "Display Preferences & GMV Metric" : "展示偏好 & GMV 口径"}</h3>
              </div>
              <span className={styles.badge}>{t(language as any, "badge_ui_only")}</span>
            </div>
            <label className={styles.stackField}>
              <span className={styles.fieldLabel}>{language === "English" ? "Language" : "语言"}</span>
              <select
                className={styles.select}
                value={language}
                onChange={(event) => {
                  const next = event.target.value;
                  setLanguage(next);
                  try { window.localStorage.setItem("aicc_language", next); } catch {}
                  try { window.dispatchEvent(new CustomEvent("aicc_language_change", { detail: next })); } catch {}
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
                        languages: [next, ...settings.languages.filter((l) => l !== next)],
                        timezones: [timezone, ...settings.timezones.filter((t) => t !== timezone)],
                        pipelineStatuses: settings.pipelineStatuses,
                      }),
                    },
                    { method: "post", encType: "application/x-www-form-urlencoded" },
                  );
                }}
              >
                {settings.languages.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
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
            <p className={styles.helpText}>{t(language as any, "gmv_metric_help")}</p>
          </div>
        </div>

          <div className={styles.card}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.sectionLabel}>{language === "English" ? "Data Export" : "数据导出"}</p>
                <h3 className={styles.sectionTitle}>{language === "English" ? "CSV Download" : "CSV 下载"}</h3>
              </div>
              <span className={styles.badge}>{t(language as any, "badge_analysis")}</span>
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
              href={toCsvHref(exports.ordersCsv)}
              download="ai-orders-90d.csv"
            >
              {language === "English" ? "Download CSV" : "下载 CSV"}
            </a>
          </div>
          <div className={styles.exportCard}>
            <h4>{t(language as any, "products_section_title")}</h4>
            <p>{language === "English" ? "Fields: product title, AI orders, AI GMV, AI share, top channel, URL (with product ID/handle for analysis)." : "字段：产品名、AI 订单数、AI GMV、AI 占比、Top 渠道、URL（附产品 ID / handle 便于二次分析）。"}</p>
            <a
              className={styles.secondaryButton}
              href={toCsvHref(exports.productsCsv)}
              download="ai-products-90d.csv"
            >
              {language === "English" ? "Download CSV" : "下载 CSV"}
            </a>
          </div>
          <div className={styles.exportCard}>
            <h4>{language === "English" ? "Customers LTV (Window)" : "Customers LTV（选定窗口）"}</h4>
            <p>{t(language as any, "customers_ltv_desc")}</p>
            <a
              className={styles.secondaryButton}
              href={toCsvHref(exports.customersCsv)}
              download="customers-ltv-90d.csv"
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
            {settings.pipelineStatuses.map((item) => (
              <div key={item.title} className={styles.statusRow}>
                <div>
                  <div className={styles.ruleTitle}>{item.title}</div>
                  <div className={styles.ruleMeta}>{item.detail}</div>
                </div>
                <span
                  className={`${styles.statusBadge} ${
                    item.status === "healthy"
                      ? styles.statusHealthy
                      : item.status === "warning"
                        ? styles.statusWarning
                        : styles.statusInfo
                  }`}
                >
                  {item.status}
                </span>
              </div>
            ))}
          </div>
          <p className={styles.helpText}>
            {language === "English" ? "Enable both webhook and scheduled backfill to avoid gaps from short outages; tag write-back only works when enabled here." : "建议同时开启 webhook + 定时补拉，避免短时异常导致的漏数；写回标签需在此处开启后才会生效。"}
          </p>
        </div>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

function LlmsPreview({ language }: { language: string }) {
  const fetcher = useFetcher<{ ok: boolean; text: string }>();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    fetcher.load(`/api/llms-txt-preview?ts=${Date.now()}`);
  }, [language]);

  const text = fetcher.data?.text || (language === "English" ? "# Generating..." : "# 生成中...");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div>
      <textarea readOnly className={styles.textarea} value={text} rows={10} />
      <div className={styles.inlineActions}>
        <button type="button" className={styles.secondaryButton} onClick={copy}>
          {copied ? (language === "English" ? "Copied" : "已复制") : (language === "English" ? "Copy" : "复制")}
        </button>
        <a href="/api/llms-txt-preview?download=1" className={styles.primaryButton}>
          {language === "English" ? "Download llms.txt" : "下载 llms.txt"}
        </a>
      </div>
    </div>
  );
}
