import { useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { json, useFetcher, useLoaderData, useNavigate, useLocation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import {
  buildDashboardData,
  buildDashboardFromOrders,
  channelList,
  resolveDateRange,
  type AIChannel,
  type AiDomainRule,
  type DateRange,
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
import { loadOrdersFromDb, persistOrders } from "../lib/persistence.server";
import { applyAiTags } from "../lib/tagging.server";
import { authenticate } from "../shopify.server";
import styles from "./app.settings.module.css";
import { allowDemoData, getPlatform } from "../lib/runtime.server";

const BACKFILL_COOLDOWN_MINUTES = 30;

const BACKFILL_COOLDOWN_MINUTES = 30;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const shopDomain = session?.shop || "";
  let settings = await getSettings(shopDomain);
  settings = await syncShopPreferences(admin, shopDomain, settings);
  const displayTimezone = settings.timezones[0] || "UTC";
  const calculationTimezone = displayTimezone || "UTC";
  const exportRange = (url.searchParams.get("range") as TimeRangeKey) || "90d";
  const range: DateRange = resolveDateRange(
    exportRange,
    new Date(),
    undefined,
    undefined,
    calculationTimezone,
  );

  let orders = await loadOrdersFromDb(shopDomain, range);
  let clamped = false;
  const demoAllowed = allowDemoData();

  if (orders.length === 0) {
    try {
      const fetched = await fetchOrdersForRange(admin, range, settings, {
        shopDomain,
        intent: "settings-export",
        rangeLabel: range.label,
      });
      orders = fetched.orders;
      clamped = fetched.clamped;
      if (orders.length > 0) {
        await persistOrders(shopDomain, orders);
      }
    } catch (error) {
      console.error("Failed to load Shopify orders for export", error);
    }
  }

  const exports = orders.length
    ? buildDashboardFromOrders(
        orders,
        range,
        settings.gmvMetric,
        displayTimezone,
        settings.primaryCurrency,
      ).exports
    : demoAllowed
      ? buildDashboardData(range, settings.gmvMetric, displayTimezone, settings.primaryCurrency).exports
      : buildDashboardFromOrders(
          [],
          range,
          settings.gmvMetric,
          displayTimezone,
          settings.primaryCurrency,
        ).exports;

  return { settings, exports, exportRange, clamped };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { session, admin } = await authenticate.admin(request);
    const shopDomain = session?.shop || "";
    const platform = getPlatform();
    const formData = await request.formData();
    const intent = formData.get("intent") || "save";
    const incoming = formData.get("settings");

    if (!incoming) {
      throw new Error("Missing settings payload");
    }

    let normalized;
    try {
      normalized = normalizeSettingsPayload(incoming.toString());
    } catch (parseError) {
      return json(
        { ok: false, message: "设置格式无效，请刷新后重试" },
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
        return json(
          { ok: false, message: "距离上次补拉不足 30 分钟，已复用现有数据。" },
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
      console.info("[backfill] settings-trigger completed", {
        platform,
        shopDomain,
        intent,
        fetched: orders.length,
        created: result.created,
        updated: result.updated,
      });
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
      console.info("[tagging] settings-trigger completed", {
        platform,
        shopDomain,
        intent,
        aiOrders: aiOrders.length,
        totalOrders: orders.length,
        created: result.created,
        updated: result.updated,
      });
    }

    return json({ ok: true, intent });
  } catch (error) {
    console.error("Failed to save settings", {
      message: (error as Error).message,
    });
    return json(
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
      shopify.toast.show?.("域名格式不合法，请输入如 chat.openai.com");
      return;
    }
    setDomains((prev) => [
      ...prev,
      { domain: newDomain.trim(), channel: newDomainChannel, source: "custom" },
    ]);
    setNewDomain("");
    shopify.toast.show?.("已添加自定义 AI 域名，点击保存后生效");
  };

  const removeDomain = (rule: AiDomainRule) => {
    if (
      rule.source === "default" &&
      !window.confirm("删除默认域名可能导致漏标，确定要移除这一项吗？")
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
      shopify.toast.show?.("utm_source 仅支持字母/数字/中划线/下划线");
      return;
    }
    setUtmMappings((prev) => [...prev, { value, channel: newSourceChannel }]);
    setNewSource("");
    shopify.toast.show?.("新增 utm_source 规则，保存后应用到识别逻辑");
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
            ? "标签写回已触发（基于最近 90 天 AI 订单）"
            : fetcher.data.intent === "backfill"
              ? "已补拉最近 90 天订单（含 AI 识别）"
              : "设置已保存";
        shopify.toast.show?.(message);
      } else {
        shopify.toast.show?.(
          fetcher.data.message || "保存失败，请检查配置或稍后重试",
        );
        if (import.meta.env.DEV && fetcher.data.message) {
          // eslint-disable-next-line no-console
          console.error("Save settings failed", fetcher.data.message);
        }
      }
    }
  }, [fetcher.data, shopify]);

  return (
    <s-page heading="设置 / 规则 & 导出">
      <div className={styles.page}>
      <div className={styles.lede}>
        <h1>AI 渠道识别规则 & 数据导出</h1>
        <p>
          控制 referrer / UTM 匹配规则、标签写回、语言时区，支持一键导出 AI 渠道订单和产品榜单
          CSV。所有演示数据均基于 v0.1 保守识别。
        </p>
        <div className={styles.alert}>
          <strong>AI 渠道识别为保守估计：</strong>依赖 referrer / UTM / 标签，部分 AI 会隐藏来源；仅统计站外 AI
          点击到站并完成订单的链路，不代表 AI 渠道的全部曝光或 GMV。
        </div>
        <p className={styles.helpText}>
          默认规则已覆盖 ChatGPT / Perplexity / Gemini / Copilot / Claude / DeepSeek 等常见 referrer 与
          utm_source（chatgpt、perplexity、gemini、copilot、deepseek、claude），安装后无需改动即可识别主流 AI 域名与 UTM。
        </p>
        <p className={styles.helpText}>
          标签默认前缀：订单 AI-Source-*，客户 AI-Customer；如需自定义请在下方修改并保存。
        </p>
        <div className={styles.inlineStats}>
          <span>最近 webhook：{settings.lastOrdersWebhookAt ? new Date(settings.lastOrdersWebhookAt).toLocaleString() : "暂无"}</span>
          <span>最近补拉：{settings.lastBackfillAt ? new Date(settings.lastBackfillAt).toLocaleString() : "暂无"}</span>
          <span>最近标签写回：{settings.lastTaggingAt ? new Date(settings.lastTaggingAt).toLocaleString() : "暂无 / 模拟"}</span>
          <span>店铺货币：{settings.primaryCurrency || "USD"}</span>
          {clamped && <span>提示：导出/补拉已限制为最近 90 天内的订单窗口。</span>}
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
          >
            补拉最近 90 天订单
          </button>
        </div>
        <div className={styles.alert}>
          当前版本针对单次 Backfill 做了保护：最多回拉 90 天 / 1000 笔订单。日订单量较大的店铺请拆分时间窗口分批回填，避免 webhook 漏数。
        </div>
      </div>

        <div className={styles.gridTwo}>
          <div className={styles.card}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.sectionLabel}>AI 域名识别</p>
                <h3 className={styles.sectionTitle}>Referrer 域名表</h3>
              </div>
              <span className={styles.badge}>优先级最高</span>
            </div>
            <div className={styles.ruleList}>
              {domains.map((rule) => (
                <div key={`${rule.domain}-${rule.channel}`} className={styles.ruleRow}>
                  <div>
                    <div className={styles.ruleTitle}>{rule.domain}</div>
                    <div className={styles.ruleMeta}>
                      渠道：{rule.channel} · {rule.source === "default" ? "默认" : "自定义"}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={styles.linkButton}
                    title={rule.source === "default" ? "移除默认域名可能导致漏标" : "删除规则"}
                    onClick={() => removeDomain(rule)}
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
            <div className={styles.inlineForm}>
              <input
                className={styles.input}
                placeholder="新增域名，例如 agent.example.com"
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
                添加域名
              </button>
            </div>
            <p className={styles.helpText}>
              编辑默认域名可能导致漏标/误标，建议只新增或停用可疑域名；referrer 匹配优先级高于 UTM。Copilot 仅在
              copilot.microsoft.com 或附带 chat/copilot 参数的 bing.com referrer 时计入，避免误把普通
              Bing 搜索视为 AI。
            </p>
          </div>

          <div className={styles.card}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.sectionLabel}>UTM 匹配规则</p>
                <h3 className={styles.sectionTitle}>utm_source → 渠道映射</h3>
              </div>
              <span className={styles.badge}>辅助识别</span>
            </div>
            <div className={styles.ruleList}>
              {utmMappings.map((rule) => (
                <div key={`${rule.value}-${rule.channel}`} className={styles.ruleRow}>
                  <div>
                    <div className={styles.ruleTitle}>{rule.value}</div>
                    <div className={styles.ruleMeta}>渠道：{rule.channel}</div>
                  </div>
                  <button
                    type="button"
                    className={styles.linkButton}
                    onClick={() => removeUtmMapping(rule.value)}
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
            <div className={styles.inlineForm}>
              <input
                className={styles.input}
                placeholder="新增 utm_source，例如 ai-referral"
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
                添加 UTM
              </button>
            </div>
            <label className={styles.stackField}>
              <span className={styles.fieldLabel}>utm_medium 关键词（逗号分隔）</span>
              <input
                className={styles.input}
                value={utmMediumInput}
                onChange={(event) => setUtmMediumInput(event.target.value)}
              />
              <span className={styles.helpText}>
                当前关键词：{utmMediumKeywords.join(", ") || "无"}
              </span>
            </label>
          </div>
        </div>

        <div className={styles.gridTwo}>
          <div className={styles.card}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.sectionLabel}>标签写回</p>
                <h3 className={styles.sectionTitle}>控制 Shopify 标签行为</h3>
              </div>
              <div className={styles.inlineActions}>
                <button type="button" className={styles.secondaryButton} onClick={submitSettings}>
                  保存
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
                  立即写回标签
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
                <div className={styles.ruleTitle}>向订单写回 AI 渠道标签</div>
                <div className={styles.ruleMeta}>
                  前缀：{tagging.orderTagPrefix}-ChatGPT / Perplexity / ...
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
                <div className={styles.ruleTitle}>向客户写回 AI 获客标签</div>
                <div className={styles.ruleMeta}>示例：{tagging.customerTag}</div>
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
                <div className={styles.ruleTitle}>实际写入 Shopify（关闭则为模拟）</div>
                <div className={styles.ruleMeta}>
                  默认模拟模式避免误写；取消选中后才会真正写入订单/客户标签。
                </div>
              </div>
            </div>
            <div className={styles.alert}>
              启用后，本应用会修改订单 / 客户标签。若你依赖标签驱动自动化流程，请先在测试店验证。默认前缀：
              {tagging.orderTagPrefix || "AI-Source"}-* / 客户标签 {tagging.customerTag || "AI-Customer"}，建议避免与现有标签冲突。
            </div>
            <label className={styles.stackField}>
              <span className={styles.fieldLabel}>订单标签前缀</span>
              <input
                className={styles.input}
                value={tagging.orderTagPrefix}
                onChange={(event) =>
                  setTagging((prev) => ({ ...prev, orderTagPrefix: event.target.value }))
                }
              />
            </label>
            <label className={styles.stackField}>
              <span className={styles.fieldLabel}>客户标签</span>
              <input
                className={styles.input}
                value={tagging.customerTag}
                onChange={(event) =>
                  setTagging((prev) => ({ ...prev, customerTag: event.target.value }))
                }
              />
            </label>
            <p className={styles.helpText}>
              标签默认关闭；开启后会回写到 Shopify 订单/客户，便于在后台过滤或导出。
            </p>
          </div>

          <div className={styles.card}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.sectionLabel}>llms.txt 偏好（预留）</p>
                <h3 className={styles.sectionTitle}>希望向 AI 暴露的站点类型</h3>
              </div>
              <span className={styles.badge}>实验</span>
            </div>
            <p className={styles.helpText}>
              仅存储偏好，不会改动店铺页面。未来生成 llms.txt 时会参考此配置；默认全部关闭以避免暴露不必要的内容。
            </p>
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
                <div className={styles.ruleTitle}>允许 AI 访问产品页</div>
                <div className={styles.ruleMeta}>product_url / handle</div>
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
                <div className={styles.ruleTitle}>允许 AI 访问合集/分类页</div>
                <div className={styles.ruleMeta}>未来用于生成精选集合</div>
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
                <div className={styles.ruleTitle}>允许 AI 访问博客内容</div>
                <div className={styles.ruleMeta}>博客/内容页可选暴露</div>
              </div>
            </div>
          </div>

          <div className={styles.card}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.sectionLabel}>语言 / 时区</p>
                <h3 className={styles.sectionTitle}>展示偏好 & GMV 口径</h3>
              </div>
              <span className={styles.badge}>仅影响 UI</span>
            </div>
            <label className={styles.stackField}>
              <span className={styles.fieldLabel}>语言</span>
              <select
                className={styles.select}
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
              >
                {settings.languages.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.stackField}>
              <span className={styles.fieldLabel}>时区</span>
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
              <span className={styles.fieldLabel}>GMV 口径</span>
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
                <option value="current_total_price">current_total_price（含税/运费）</option>
                <option value="subtotal_price">subtotal_price（不含税/运费）</option>
              </select>
            </label>
            <p className={styles.helpText}>仅影响 UI 展示，不影响底层数据口径。</p>
          </div>
        </div>

        <div className={styles.card}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.sectionLabel}>数据导出</p>
              <h3 className={styles.sectionTitle}>CSV 下载</h3>
            </div>
            <span className={styles.badge}>适合二次分析</span>
          </div>
          <div className={styles.inlineForm}>
            <label className={styles.fieldLabel}>导出时间范围</label>
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
              <option value="30d">最近 30 天</option>
              <option value="90d">最近 90 天</option>
            </select>
            <span className={styles.helpText}>切换后将重新加载并生成对应区间的导出。</span>
          </div>
          <div className={styles.exportGrid}>
            <div className={styles.exportCard}>
              <h4>AI 渠道订单明细</h4>
              <p>
                字段：订单号、下单时间、AI 渠道、GMV（按当前 GMV 口径）、referrer、landing_page、source_name、utm_source、utm_medium、解析结果
                （附加 order_id / customer_id / new_customer 标记便于对照）。
              </p>
              <a
                className={styles.primaryButton}
                href={toCsvHref(exports.ordersCsv)}
                download="ai-orders-90d.csv"
              >
                下载 CSV
              </a>
            </div>
            <div className={styles.exportCard}>
              <h4>Top Products from AI Channels</h4>
              <p>字段：产品名、AI 订单数、AI GMV、AI 占比、Top 渠道、URL（附产品 ID / handle 便于二次分析）。</p>
              <a
                className={styles.secondaryButton}
                href={toCsvHref(exports.productsCsv)}
                download="ai-products-90d.csv"
              >
                下载 CSV
              </a>
            </div>
          </div>
          <p className={styles.helpText}>
            导出仅包含已被识别的 AI 渠道订单；若 AI 样本量很低，建议延长时间窗口后再导出。导出的 GMV 字段随「GMV 口径」设置切换。
          </p>
        </div>

        <div className={styles.card}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.sectionLabel}>数据采集健康度</p>
              <h3 className={styles.sectionTitle}>Webhook / Backfill / 标签写回</h3>
            </div>
            <span className={styles.badge}>监控</span>
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
            建议同时开启 webhook + 定时补拉，避免短时异常导致的漏数；写回标签需在此处开启后才会生效。
          </p>
        </div>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
