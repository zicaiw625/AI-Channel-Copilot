import { useCallback, useEffect, useMemo, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useFetcher, useLoaderData, useLocation, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { channelList, defaultSettings, timeRanges, type AIChannel, type TimeRangeKey, LOW_SAMPLE_THRESHOLD } from "../lib/aiData";
import { getSettings, syncShopPreferences } from "../lib/settings.server";
import { authenticate } from "../shopify.server";
import styles from "../styles/app.dashboard.module.css";
import { getAiDashboardData } from "../lib/aiQueries.server";
import { ensureRetentionOncePerDay } from "../lib/retention.server";
import {
  DEFAULT_RANGE_KEY,
  DEFAULT_RETENTION_MONTHS,
  MAX_DASHBOARD_ORDERS,
} from "../lib/constants";
import { loadDashboardContext } from "../lib/dashboardContext.server";
import { t } from "../lib/i18n";
type Lang = "English" | "中文";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session?.shop || "";
  const url = new URL(request.url);

  let settings = await getSettings(shopDomain);
  settings = await syncShopPreferences(admin, shopDomain, settings);

  await ensureRetentionOncePerDay(shopDomain, settings);

  const context = await loadDashboardContext({
    shopDomain,
    admin,
    settings,
    url,
    defaultRangeKey: DEFAULT_RANGE_KEY,
    includeBackfillState: true,
  });

  const { data } = await getAiDashboardData(shopDomain, context.dateRange, settings, {
    timezone: context.displayTimezone,
    allowDemo: context.dataSource === "demo",
    orders: context.orders,
  });

  return {
    range: context.dateRange.key,
    dateRange: {
      ...context.dateRange,
      start: context.dateRange.start.toISOString(),
      end: context.dateRange.end.toISOString(),
    },
    data,
    dataSource: context.dataSource,
    gmvMetric: settings.gmvMetric,
    currency: context.currency,
    calculationTimezone: context.calculationTimezone,
    timezone: context.displayTimezone,
    language: context.language,
    retentionMonths: settings.retentionMonths || DEFAULT_RETENTION_MONTHS,
    lastCleanupAt: settings.lastCleanupAt || null,
    backfillSuppressed: context.backfillSuppressed,
    backfillAvailable: context.backfillAvailable,
    dataLastUpdated: context.dataLastUpdated,
    pipeline: {
      lastOrdersWebhookAt: settings.lastOrdersWebhookAt || null,
      lastBackfillAt: settings.lastBackfillAt || null,
      lastTaggingAt: settings.lastTaggingAt || null,
      statuses:
        settings.pipelineStatuses && settings.pipelineStatuses.length
          ? settings.pipelineStatuses
          : defaultSettings.pipelineStatuses,
    },
    clamped: context.clamped,
  };
};

const fmtNumber = (value: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);

const fmtPercent = (value: number, fractionDigits = 1) =>
  `${(value * 100).toFixed(fractionDigits)}%`;

type TrendScope = "overall" | "ai" | AIChannel;

type JobStatus = "queued" | "processing" | "completed" | "failed";

type JobSnapshot = {
  ok: boolean;
  backfills: {
    recent: {
      id: number;
      range: string;
      status: JobStatus;
      error?: string | null;
      ordersFetched: number;
      createdAt: string;
      startedAt?: string | null;
      finishedAt?: string | null;
    }[];
    counts: Partial<Record<JobStatus, number>>;
  };
  webhooks: {
    recent: {
      id: number;
      topic: string;
      intent: string;
      status: JobStatus;
      error?: string | null;
      createdAt: string;
      startedAt?: string | null;
      finishedAt?: string | null;
    }[];
    counts: Partial<Record<JobStatus, number>>;
  };
};

export default function Index() {
  const {
    range,
    dateRange,
    data,
    dataSource,
    gmvMetric,
    currency,
    calculationTimezone,
    timezone,
    language,
    pipeline,
    clamped,
    backfillSuppressed,
    backfillAvailable,
    dataLastUpdated,
  } = useLoaderData<typeof loader>();
  const lang = language as Lang;
  const navigate = useNavigate();
  const location = useLocation();
  const [metricView, setMetricView] = useState<"gmv" | "orders" | "newCustomers">("gmv");
  const [trendMetric, setTrendMetric] = useState<"gmv" | "orders">("gmv");
  const [trendScope, setTrendScope] = useState<TrendScope>("ai");
  const [customFrom, setCustomFrom] = useState(
    (dateRange.fromParam as string | undefined) || dateRange.start.slice(0, 10),
  );
  const [customTo, setCustomTo] = useState(
    (dateRange.toParam as string | undefined) || dateRange.end.slice(0, 10),
  );
  const [debugOrderFilter, setDebugOrderFilter] = useState("");
  const [debugChannelFilter, setDebugChannelFilter] = useState<"" | TrendScope>("");
  const locale = language === "English" ? "en-US" : "zh-CN";
  const fmtCurrency = useCallback(
    (value: number) =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency: currency || "USD",
        maximumFractionDigits: 0,
      }).format(value),
    [currency, locale],
  );
  const timeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        timeZone: timezone,
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [locale, timezone],
  );
  const fmtTime = useCallback(
    (iso?: string | null) => (iso ? timeFormatter.format(new Date(iso)) : (language === "English" ? "None" : "暂无")),
    [timeFormatter, language],
  );

  useEffect(() => {
    setCustomFrom((dateRange.fromParam as string | undefined) || dateRange.start.slice(0, 10));
    setCustomTo((dateRange.toParam as string | undefined) || dateRange.end.slice(0, 10));
  }, [dateRange.end, dateRange.fromParam, dateRange.start, dateRange.toParam]);

  const backfillFetcher = useFetcher<{ ok: boolean; queued: boolean; reason?: string; range?: string }>();
  const jobFetcher = useFetcher<JobSnapshot>();

  useEffect(() => {
    const poll = () => {
      if (document.visibilityState !== "visible") return;
      if (jobFetcher.state !== "loading") {
        jobFetcher.load("/api/jobs");
      }
    };
    poll();
    let timer = window.setInterval(poll, 12000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        poll();
        clearInterval(timer);
        timer = window.setInterval(poll, 12000);
      } else {
        clearInterval(timer);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [jobFetcher]);
  const triggerBackfill = useCallback(() => {
    backfillFetcher.submit(
      { range, from: dateRange.fromParam || "", to: dateRange.toParam || "" },
      { method: "post", action: "/api/backfill" },
    );
  }, [backfillFetcher, dateRange.fromParam, dateRange.toParam, range]);

  const {
    overview,
    channels,
    comparison,
    trend,
    topProducts,
    topCustomers,
    recentOrders,
    sampleNote,
    exports: exportData,
  } = data;
  const isLowSample = overview.aiOrders < LOW_SAMPLE_THRESHOLD;

  const filteredRecentOrders = useMemo(() => {
    const keyword = debugOrderFilter.trim().toLowerCase();
    return recentOrders.filter((order) => {
      const matchesChannel =
        !debugChannelFilter
          ? true
          : debugChannelFilter === "ai"
            ? Boolean(order.aiSource)
            : debugChannelFilter === "overall"
              ? !order.aiSource
              : order.aiSource === debugChannelFilter;

      const matchesKeyword =
        !keyword ||
        order.name.toLowerCase().includes(keyword) ||
          order.id.toLowerCase().includes(keyword) ||
          (order.aiSource || "").toLowerCase().includes(keyword);

      return matchesChannel && matchesKeyword;
    });
  }, [debugChannelFilter, debugOrderFilter, recentOrders]);

  const trendScopes = useMemo(
    () => [
      { key: "overall" as TrendScope, label: language === "English" ? "All Orders" : "全部订单" },
      { key: "ai" as TrendScope, label: language === "English" ? "AI Summary" : "AI 汇总" },
      ...channelList.map((channel) => ({ key: channel as TrendScope, label: channel })),
    ],
    [language],
  );

  const channelMax = useMemo(() => {
    const values = channels.map((channel) => {
      if (metricView === "gmv") return channel.gmv;
      if (metricView === "orders") return channel.orders;
      return channel.newCustomers;
    });
    return Math.max(1, ...values);
  }, [channels, metricView]);

  const getTrendValue = useCallback(
    (point: (typeof trend)[number]) => {
      if (trendScope === "overall") {
        return trendMetric === "gmv" ? point.overallGMV : point.overallOrders;
      }
      if (trendScope === "ai") {
        return trendMetric === "gmv" ? point.aiGMV : point.aiOrders;
      }
      const channelMetrics = point.byChannel[trendScope];
      if (!channelMetrics) return 0;
      return trendMetric === "gmv" ? channelMetrics.gmv : channelMetrics.orders;
    },
    [trendMetric, trendScope],
  );

  const trendScopeLabel =
    trendScopes.find((item) => item.key === trendScope)?.label || (language === "English" ? "AI Summary" : "AI 汇总");

  const trendMax = useMemo(
    () => Math.max(1, ...trend.map((point) => getTrendValue(point))),
    [getTrendValue, trend],
  );

  const setRange = (value: TimeRangeKey) => {
    const params = new URLSearchParams(location.search);
    params.set("range", value);
    if (value === "custom") {
      if (customFrom) params.set("from", customFrom);
      if (customTo) params.set("to", customTo || customFrom);
    } else {
      params.delete("from");
      params.delete("to");
    }
    navigate({ search: `?${params.toString()}` });
  };

  const getRangeLabel = (key: TimeRangeKey) => {
    if (language === "English") {
      if (key === "7d") return "Last 7 days";
      if (key === "30d") return "Last 30 days";
      if (key === "90d") return "Last 90 days";
      if (key === "custom") return "Custom";
    }
    return timeRanges[key].label;
  };

  const applyCustomRange = () => {
    if (!customFrom) return;
    const params = new URLSearchParams(location.search);
    params.set("range", "custom");
    params.set("from", customFrom);
    params.set("to", customTo || customFrom);
    navigate({ search: `?${params.toString()}` });
  };

  return (
    <s-page heading={language === "English" ? "AI Discovery & Attribution" : "AI 渠道基础仪表盘"}>
      <div className={styles.page}>
        <div className={styles.pageHeader}>
          <div className={styles.titleBlock}>
            <div className={styles.badgeRow}>
              <span className={styles.badge}>{t(lang, "badge_v01")}</span>
              <span className={styles.badgeSecondary}>{t(lang, "badge_conservative_orders")}</span>
              {isLowSample && (
                <span className={styles.badgeSecondary}>
                  {language === "English" ? `Sample < ${LOW_SAMPLE_THRESHOLD} · metrics for reference only` : `样本 < ${LOW_SAMPLE_THRESHOLD} · 指标仅供参考`}
                </span>
              )}
            </div>
            <h1 className={styles.heading}>{t(lang, "dashboard_title")}</h1>
            <p className={styles.subheading}>{t(lang, "dashboard_subheading")}</p>
            <div className={styles.warning}>
              <strong>{language === "English" ? "Note:" : "说明："}</strong>{t(lang, "dashboard_warning")}
            </div>
            <div className={styles.metaRow}>
              <span>{t(lang, "meta_synced_at")}{timeFormatter.format(new Date(overview.lastSyncedAt))}</span>
              <span>
                {t(lang, "meta_updated_at")}{dataLastUpdated ? timeFormatter.format(new Date(dataLastUpdated)) : (language === "English" ? "None" : "暂无")}
                {backfillSuppressed && (language === "English" ? " (Backfilled within 30 minutes; using cached data)" : "（30 分钟内已补拉，复用缓存数据）")}
                {backfillAvailable && (language === "English" ? " (Manual backfill available)" : "（可手动触发后台补拉）")}
              </span>
              <span>{t(lang, "meta_range")}{dateRange.label}</span>
              <span>
                {t(lang, "meta_metric_scope")} {gmvMetric} · {language === "English" ? "New Customers = first-order customers (window)" : "新客=首单客户（仅限当前时间范围）"} · {language === "English" ? "GMV computed from order fields" : "GMV 仅基于订单字段"}
              </span>
              <span>
                {t(lang, "meta_data_source")}
                {dataSource === "live"
                  ? (language === "English" ? "Shopify Live Orders" : "Shopify 实时订单")
                  : dataSource === "stored"
                    ? (language === "English" ? "Stored Orders" : "已缓存的店铺订单")
                    : dataSource === "demo"
                      ? (language === "English" ? "Demo samples (no AI orders found)" : "Demo 样例（未检索到 AI 订单）")
                      : (language === "English" ? "No data (demo disabled)" : "暂无数据（未启用演示数据）")}
                {language === "English" ? " (live=API, stored=cached, demo=samples)" : "（live=实时 API，stored=本地缓存，demo=演示数据）"}
              </span>
              {clamped && <span>{language === "English" ? `Hint: truncated to latest ${MAX_DASHBOARD_ORDERS} orders.` : `提示：已截断为最近 ${MAX_DASHBOARD_ORDERS} 笔订单样本。`}</span>}
              <span>
                {t(lang, "meta_timezones_currency")}{calculationTimezone} · {language === "English" ? "Display TZ" : "展示时区"}：{timezone} · {language === "English" ? "Currency" : "货币"}：{currency}
              </span>
            </div>
            <details className={styles.statusBlock}>
              <summary>{t(lang, "status_ops")}</summary>
              <div className={styles.pipelineRow}>
                <span>{language === "English" ? "Webhook:" : "Webhook："}{fmtTime(pipeline.lastOrdersWebhookAt)}</span>
                <span>{language === "English" ? "Backfill:" : "补拉："}{fmtTime(pipeline.lastBackfillAt)}</span>
                <span>{language === "English" ? "Tagging:" : "标签："}{fmtTime(pipeline.lastTaggingAt)}</span>
                <div className={styles.statusChips}>
                  {(pipeline.statuses || []).map((item) => (
                    <span
                      key={item.title}
                      className={`${styles.statusChip} ${
                        item.status === "healthy"
                          ? styles.statusHealthy
                          : item.status === "warning"
                            ? styles.statusWarning
                            : styles.statusInfo
                      }`}
                    >
                      {item.title}: {item.status}
                    </span>
                  ))}
                </div>
                {backfillAvailable && (
                  <div className={styles.backfillRow}>
                    <button
                      className={styles.primaryButton}
                      onClick={triggerBackfill}
                      disabled={backfillFetcher.state !== "idle"}
                    >
                      {backfillFetcher.state === "idle" ? (language === "English" ? "Backfill in background" : "后台补拉") : (language === "English" ? "后台补拉中..." : "后台补拉中...")}
                    </button>
                    {backfillFetcher.data && (
                      <span className={styles.backfillStatus}>
                        {backfillFetcher.data.queued
                          ? (language === "English" ? `Background task triggered (${backfillFetcher.data.range})` : `已触发后台任务（${backfillFetcher.data.range}）`)
                          : backfillFetcher.data.reason === "in-flight"
                            ? (language === "English" ? "A backfill is already running; refresh later" : "已有补拉在进行中，稍后刷新")
                            : (language === "English" ? "Cannot trigger backfill; check shop session" : "无法触发补拉，请确认店铺会话")}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </details>
            {/* 补拉提示移入系统状态折叠块，避免首页拥挤 */}
            {dataSource === "demo" && (
              <div className={styles.callout}>
                <span>{t(lang, "hint_title")}</span>
                {language === "English" ? "No identifiable AI orders in this shop. Showing demo data. Check time range, referrer/UTM rules, or extend the window and retry." : "当前店铺暂无可识别的 AI 渠道订单，以下为演示数据。可检查时间范围、referrer/UTM 规则，或延长观测窗口后再试。"}
              </div>
            )}
            {dataSource === "empty" && (
              <div className={styles.warning}>
                {language === "English" ? "No qualifying orders found and demo is disabled. Wait for webhook/backfill or extend the time range and retry." : "暂未检索到符合条件的订单，且已关闭演示数据。可等待 webhook/backfill 完成或延长时间范围后重试。"}
              </div>
            )}
            {overview.aiOrders === 0 && overview.totalOrders > 0 && (
              <div className={styles.callout}>
                <span>{language === "English" ? "Hint" : "提示"}</span>
                {t(lang, "hint_zero_ai")}
                <Link to="/app/additional" className={styles.link}>{t(lang, "goto_settings")}</Link>
              </div>
            )}
            </div>
            <div className={styles.actions}>
              <div className={styles.rangePills}>
                {(Object.keys(timeRanges) as TimeRangeKey[]).map((key) => (
                  <button
                    key={key}
                    className={`${styles.pill} ${range === key ? styles.pillActive : ""}`}
                    onClick={() => setRange(key)}
                    type="button"
                  >
                    {getRangeLabel(key)}
                  </button>
                ))}
              </div>
              <div className={styles.customRange}>
                <input
                  type="date"
                  className={styles.input}
                  value={customFrom}
                  onChange={(event) => setCustomFrom(event.target.value)}
                />
                <span className={styles.rangeDivider}>{language === "English" ? "to" : "至"}</span>
                <input
                  type="date"
                  className={styles.input}
                  value={customTo}
                  onChange={(event) => setCustomTo(event.target.value)}
                />
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={applyCustomRange}
                >
                  {language === "English" ? "Apply Custom" : "应用自定义"}
                </button>
              </div>
              <div className={styles.actionButtons}>
                <Link to="/app/additional" className={styles.primaryButton}>
                  {language === "English" ? "Settings / Rules & Export" : "设置 / 规则 & 导出"}
                </Link>
                <Link to="/app/copilot" className={styles.secondaryButton}>
                  {language === "English" ? "Copilot Q&A" : "Copilot 分析问答"}
                </Link>
                <a
                  className={styles.secondaryButton}
                  href={`/api/export/orders?range=${range}&from=${encodeURIComponent(dateRange.fromParam || "")}&to=${encodeURIComponent(dateRange.toParam || "")}`}
                >
                  {t(lang, "export_orders_csv")}
                </a>
        </div>
        </div>

          <div className={styles.card}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.sectionLabel}>{t(lang, "metrics_section_label")}</p>
                <h3 className={styles.sectionTitle}>{t(lang, "metrics_section_title")}</h3>
              </div>
              <span className={styles.smallBadge}>{language === "English" ? "Reference" : "参考"}</span>
            </div>
            <ul className={styles.helpList}>
            <li>{language === "English" ? `GMV: aggregated by ${gmvMetric} (${gmvMetric === "subtotal_price" ? "excluding tax/shipping" : "including tax/shipping"}).` : `GMV：按设置的 ${gmvMetric} 字段汇总（当前为 ${gmvMetric === "subtotal_price" ? "不含税/运费" : "含税/运费"}）。`}</li>
            <li>{language === "English" ? "AI GMV: only orders identified as AI channel." : "AI GMV：仅统计被识别为 AI 渠道的订单 GMV。"}</li>
            <li>{language === "English" ? "LTV (if shown): historical accumulated GMV within window, no prediction." : "LTV（如展示）：当前为历史累积 GMV，不含预测。"}</li>
            </ul>
          </div>
        </div>

        <div className={styles.kpiGrid}>
          <div className={styles.card}>
            <p className={styles.cardLabel}>{t(lang, "kpi_total_gmv")}</p>
            <p className={styles.cardValue}>{fmtCurrency(overview.totalGMV)}</p>
            <p className={styles.cardMeta}>
              {language === "English" ? "Orders" : t(lang, "kpi_orders")} {fmtNumber(overview.totalOrders)} · {language === "English" ? "New" : t(lang, "kpi_new_customers")} {fmtNumber(overview.totalNewCustomers)}
            </p>
            <p className={styles.helpText}>{t(lang, "kpi_net_gmv")} {fmtCurrency(overview.netGMV)}</p>
          </div>
          <div className={styles.card}>
            <p className={styles.cardLabel}>{t(lang, "kpi_ai_gmv")}</p>
            <p className={styles.cardValue}>{fmtCurrency(overview.aiGMV)}</p>
            <p className={styles.cardMeta}>{language === "English" ? "Share" : t(lang, "kpi_ai_share")} {fmtPercent(overview.aiShare)}</p>
            <p className={styles.helpText}>{language === "English" ? "AI Net GMV" : "AI 净 GMV"} {fmtCurrency(overview.netAiGMV)}</p>
          </div>
          <div className={styles.card}>
            <p className={styles.cardLabel}>{t(lang, "kpi_ai_orders")}</p>
            <p className={styles.cardValue}>{fmtNumber(overview.aiOrders)}</p>
            <p className={styles.cardMeta}>
              {language === "English" ? "Total Orders" : t(lang, "kpi_ai_order_share")} {fmtNumber(overview.totalOrders)} · {fmtPercent(overview.aiOrderShare)}
            </p>
          </div>
          <div className={styles.card}>
            <p className={styles.cardLabel}>{t(lang, "kpi_ai_new_customers")}</p>
            <p className={styles.cardValue}>{fmtNumber(overview.aiNewCustomers)}</p>
            <p className={styles.cardMeta}>
              {language === "English" ? "AI New Customer Rate" : t(lang, "kpi_ai_new_customer_rate")} {fmtPercent(overview.aiNewCustomerRate)} · {language === "English" ? "Site New" : "全站新客"} {fmtNumber(overview.totalNewCustomers)}
            </p>
          </div>
        </div>
        {isLowSample && (
          <div className={styles.lowSampleNotice}>
            {language === "English" ? `Sample < ${LOW_SAMPLE_THRESHOLD}, metrics for reference only; extend range for more stable trends.` : `样本 < ${LOW_SAMPLE_THRESHOLD}，所有指标仅供参考；延长时间范围后可获得更稳定的趋势。`}
          </div>
        )}

        <div className={styles.twoCol}>
          <div className={styles.card}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.sectionLabel}>{t(lang, "channels_section_label")}</p>
                <h3 className={styles.sectionTitle}>{t(lang, "channels_section_title")}</h3>
              </div>
              <div className={styles.toggleGroup}>
                {[
                  { key: "gmv", label: t(lang, "toggle_gmv") },
                  { key: "orders", label: t(lang, "toggle_orders") },
                  { key: "newCustomers", label: t(lang, "toggle_new_customers") },
                ].map(({ key, label }) => (
                  <button
                    key={key}
                    className={`${styles.toggle} ${metricView === key ? styles.toggleActive : ""}`}
                    onClick={() => setMetricView(key as typeof metricView)}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.channelList}>
              {channels.map((channel) => {
                const value =
                  metricView === "gmv"
                    ? channel.gmv
                    : metricView === "orders"
                      ? channel.orders
                      : channel.newCustomers;
                const barWidth = `${(value / channelMax) * 100}%`;
                return (
                  <div key={channel.channel} className={styles.channelRow}>
                    <div className={styles.channelLabel}>
                      <span className={styles.channelDot} style={{ background: channel.color }} />
                      <span>{channel.channel}</span>
                    </div>
                    <div className={styles.channelBar}>
                      <div
                        className={styles.channelFill}
                        style={{ width: barWidth, background: channel.color }}
                      />
                    </div>
                    <span className={styles.channelValue}>
                      {metricView === "gmv" ? fmtCurrency(value) : fmtNumber(value)}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className={styles.helpText}>
              {language === "English" ? "Priority: referrer > UTM. AI traffic without referrer/UTM cannot be attributed; results are conservative." : "优先级：referrer > UTM。未带 referrer/UTM 的 AI 流量无法被识别，结果为保守估计。"}
            </p>
          </div>

          <div className={styles.card}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.sectionLabel}>{t(lang, "comparison_section_label")}</p>
                <h3 className={styles.sectionTitle}>{language === "English" ? "Overall vs AI Channels" : "整体 vs 各 AI 渠道"}</h3>
              </div>
              {isLowSample ? (
                <span className={styles.smallBadge}>
                  {language === "English" ? `Sample < ${LOW_SAMPLE_THRESHOLD} · interpret with caution` : `样本 < ${LOW_SAMPLE_THRESHOLD} · 解读时请谨慎`}
                </span>
              ) : (
                <span className={styles.smallBadge}>{language === "English" ? `Sample >= ${LOW_SAMPLE_THRESHOLD}` : `样本 >= ${LOW_SAMPLE_THRESHOLD}`}</span>
              )}
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>{t(lang, "table_channel")}</th>
                    <th>{t(lang, "table_aov")}</th>
                    <th>{t(lang, "table_new_customer_rate")}</th>
                    <th>{t(lang, "table_repeat_rate")}</th>
                    <th>{t(lang, "table_sample")}</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.map((row) => (
                    <tr key={row.channel}>
                      <td className={styles.cellLabel}>
                        {row.channel}
                        {row.isLowSample && <span className={styles.chip}>{language === "English" ? "Low sample" : "样本少"}</span>}
                      </td>
                      <td>{fmtCurrency(row.aov)}</td>
                      <td>{fmtPercent(row.newCustomerRate)}</td>
                      <td>{fmtPercent(row.repeatRate)}</td>
                      <td>{fmtNumber(row.sampleSize)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {sampleNote && <p className={styles.warning}>{sampleNote}</p>}
          </div>
        </div>

        <div className={styles.twoCol}>
          <div className={styles.card}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.sectionLabel}>{language === "English" ? "Customers" : "客户维度"}</p>
                <h3 className={styles.sectionTitle}>{t(lang, "top_customers_title")}</h3>
              </div>
              <a
                className={styles.secondaryButton}
                href={`data:text/csv;charset=utf-8,${encodeURIComponent(exportData.customersCsv)}`}
                download={`customers-ltv-${range}.csv`}
              >
                {t(lang, "export_ltv_csv")}
              </a>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>{t(lang, "col_customer")}</th>
                    <th>{t(lang, "col_ltv")}</th>
                    <th>{t(lang, "col_orders")}</th>
                    <th>{t(lang, "col_ai")}</th>
                    <th>{t(lang, "col_acquired_ai")}</th>
                    <th>{t(lang, "col_repeats")}</th>
                  </tr>
                </thead>
                <tbody>
                  {topCustomers.map((row) => (
                    <tr key={row.customerId}>
                      <td className={styles.cellLabel}>{row.customerId}</td>
                      <td>{fmtCurrency(row.ltv)}</td>
                      <td>{fmtNumber(row.orders)}</td>
                      <td>{row.ai ? "✓" : "-"}</td>
                      <td>{row.firstAIAcquired ? "✓" : "-"}</td>
                      <td>{fmtNumber(row.repeatCount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={styles.helpText}>{language === "English" ? "LTV aggregated by GMV within window; good for spotting high-value customers." : "窗口内按 GMV 汇总的 LTV，适合观察高价值客户分布。"}</p>
          </div>
        </div>

        <div className={styles.twoCol}>
          <div className={styles.card}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.sectionLabel}>{language === "English" ? "Trend" : "趋势"}</p>
                <h3 className={styles.sectionTitle}>{t(lang, "trend_section_title")}</h3>
              </div>
              <div className={styles.trendControls}>
                <div className={styles.toggleGroup}>
                  {[
                    { key: "gmv", label: "GMV" },
                    { key: "orders", label: language === "English" ? "Orders" : "订单" },
                  ].map(({ key, label }) => (
                    <button
                      key={key}
                      className={`${styles.toggle} ${trendMetric === key ? styles.toggleActive : ""}`}
                      onClick={() => setTrendMetric(key as typeof trendMetric)}
                      type="button"
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className={styles.trendFilterGroup}>
                  {trendScopes.map((scope) => (
                    <button
                      key={scope.key}
                      className={`${styles.toggle} ${trendScope === scope.key ? styles.toggleActive : ""}`}
                      onClick={() => setTrendScope(scope.key)}
                      type="button"
                    >
                      {scope.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className={styles.legend}>
              <span className={styles.legendDot} />
              <span>
                {trendScopeLabel} · {trendMetric === "gmv" ? "GMV" : (language === "English" ? "Orders" : "订单数")}
              </span>
            </div>
            <div className={styles.trendList}>
              {trend.map((point) => {
                const value = getTrendValue(point);
                const secondary =
                  trendScope === "overall"
                    ? trendMetric === "gmv"
                      ? (language === "English" ? `AI GMV ${fmtCurrency(point.aiGMV)}` : `AI GMV ${fmtCurrency(point.aiGMV)}`)
                      : (language === "English" ? `AI Orders ${fmtNumber(point.aiOrders)}` : `AI 订单 ${fmtNumber(point.aiOrders)}`)
                    : trendMetric === "gmv"
                      ? (language === "English" ? `Total GMV ${fmtCurrency(point.overallGMV)}` : `总 GMV ${fmtCurrency(point.overallGMV)}`)
                      : (language === "English" ? `Total Orders ${fmtNumber(point.overallOrders)}` : `总订单 ${fmtNumber(point.overallOrders)}`);

                return (
                  <div key={point.label} className={styles.trendRow}>
                    <div className={styles.trendLabel}>{point.label}</div>
                    <div className={styles.trendBarBlock}>
                      <div className={styles.trendBar}>
                        <div
                          className={styles.trendFill}
                          style={{ width: `${(value / trendMax) * 100}%` }}
                        />
                      </div>
                      <div className={styles.trendMeta}>
                        <span>{trendMetric === "gmv" ? fmtCurrency(value) : fmtNumber(value)}</span>
                        <span>{secondary}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className={styles.helpText}>
              {language === "English" ? "Toggle GMV/Orders and filter by channel. Low sample sizes can exaggerate variance; read alongside channel details." : "可切换 GMV / 订单并按渠道过滤；样本量低时单笔订单会放大波动，解读时需结合渠道详情。"}
            </p>
        </div>

        <div className={styles.card}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.sectionLabel}>{language === "English" ? "Products" : "产品维度"}</p>
                <h3 className={styles.sectionTitle}>{t(lang, "products_section_title")}</h3>
              </div>
              <a
                className={styles.secondaryButton}
                href={`data:text/csv;charset=utf-8,${encodeURIComponent(exportData.productsCsv)}`}
                download={`ai-products-${range}.csv`}
              >
                {t(lang, "export_products_csv")}
              </a>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>{t(lang, "products_table_product")}</th>
                    <th>{language === "English" ? "Product ID / Handle" : "产品 ID / Handle"}</th>
                    <th>{t(lang, "products_table_ai_orders")}</th>
                    <th>{t(lang, "products_table_ai_gmv")}</th>
                    <th>{t(lang, "products_table_ai_share")}</th>
                    <th>{t(lang, "products_table_top_channel")}</th>
                  </tr>
                </thead>
                <tbody>
                  {topProducts.map((product) => (
                    <tr key={product.id}>
                      <td className={styles.cellLabel}>
                        <a href={product.url} target="_blank" rel="noreferrer" className={styles.link}>
                          {product.title}
                        </a>
                      </td>
                      <td>{product.id} / {product.handle}</td>
                      <td>{fmtNumber(product.aiOrders)}</td>
                      <td>{fmtCurrency(product.aiGMV)}</td>
                      <td>{fmtPercent(product.aiShare)}</td>
                      <td>{product.topChannel ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={styles.helpText}>
              {language === "English" ? "Scope: products appearing in AI-channel orders; Share = AI-channel orders / total orders of product." : "统计口径：含 AI 渠道订单中出现过的产品；占比=AI 渠道订单数 / 产品总订单数。"}
            </p>
          </div>
        </div>

          <div className={styles.card}>
            <div className={styles.sectionHeader}>
              <div>
              <p className={styles.sectionLabel}>{t(lang, "jobs_section_label")}</p>
              <h3 className={styles.sectionTitle}>{t(lang, "jobs_section_title")}</h3>
              </div>
              <span className={styles.smallBadge}>{t(lang, "jobs_small_badge")}</span>
            </div>
          <div className={styles.jobGrid}>
            <div className={styles.jobBlock}>
              <div className={styles.jobHeader}>
                <h4>{language === "English" ? "Backfill" : "补拉"}</h4>
                <div className={styles.jobCounters}>
                  {(["queued", "processing", "completed", "failed"] as JobStatus[]).map((status) => (
                    <span key={status} className={styles.counterBadge}>
                      {status}: {jobFetcher.data?.backfills.counts?.[status] ?? 0}
                    </span>
                  ))}
                </div>
              </div>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>{language === "English" ? "Range" : "范围"}</th>
                      <th>{language === "English" ? "Status" : "状态"}</th>
                      <th>{language === "English" ? "Orders Fetched" : "拉取订单"}</th>
                      <th>{language === "English" ? "Started" : "开始"}</th>
                      <th>{language === "English" ? "Finished" : "结束"}</th>
                      <th>{language === "English" ? "Error" : "错误"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(jobFetcher.data?.backfills.recent || []).map((job) => (
                      <tr key={job.id}>
                        <td>{job.id}</td>
                        <td>{job.range}</td>
                        <td>{job.status}</td>
                        <td>{job.ordersFetched}</td>
                        <td>{job.startedAt ? fmtTime(job.startedAt) : (language === "English" ? "Pending" : "待开始")}</td>
                        <td>{job.finishedAt ? fmtTime(job.finishedAt) : "-"}</td>
                        <td className={styles.errorCell}>{job.error || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className={styles.jobBlock}>
              <div className={styles.jobHeader}>
                <h4>{language === "English" ? "Order Webhook Queue" : "订单 Webhook 队列"}</h4>
                <div className={styles.jobCounters}>
                  {(["queued", "processing", "completed", "failed"] as JobStatus[]).map((status) => (
                    <span key={status} className={styles.counterBadge}>
                      {status}: {jobFetcher.data?.webhooks.counts?.[status] ?? 0}
                    </span>
                  ))}
                </div>
              </div>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Topic</th>
                      <th>Intent</th>
                      <th>{language === "English" ? "Status" : "状态"}</th>
                      <th>{language === "English" ? "Started" : "开始"}</th>
                      <th>{language === "English" ? "Finished" : "结束"}</th>
                      <th>{language === "English" ? "Error" : "错误"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(jobFetcher.data?.webhooks.recent || []).map((job) => (
                      <tr key={job.id}>
                        <td>{job.id}</td>
                        <td>{job.topic}</td>
                        <td>{job.intent}</td>
                        <td>{job.status}</td>
                        <td>{job.startedAt ? fmtTime(job.startedAt) : (language === "English" ? "Pending" : "待开始")}</td>
                        <td>{job.finishedAt ? fmtTime(job.finishedAt) : "-"}</td>
                        <td className={styles.errorCell}>{job.error || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <p className={styles.helpText}>
            {language === "English" ? "Data from /api/jobs; useful for diagnosing queue backlogs and retries across instances." : "数据来源于 /api/jobs，可用于多实例场景下排查队列堆积、失败重试等问题。"}
          </p>
        </div>

        <div className={styles.card}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.sectionLabel}>{t(lang, "debug_section_label")}</p>
              <h3 className={styles.sectionTitle}>{t(lang, "debug_section_title")}</h3>
            </div>
            <div className={styles.debugFilters}>
              <input
                type="search"
                placeholder={language === "English" ? "Filter by order name / ID / channel" : "按订单号 / ID / 渠道过滤"}
                value={debugOrderFilter}
                onChange={(event) => setDebugOrderFilter(event.target.value)}
                className={styles.searchInput}
              />
              <select
                value={debugChannelFilter || ""}
                onChange={(event) => setDebugChannelFilter(event.target.value as TrendScope | "")}
                className={styles.select}
              >
                <option value="">{language === "English" ? "All" : "全部"}</option>
                <option value="ai">{language === "English" ? "AI Channels" : "AI 渠道"}</option>
                <option value="overall">{language === "English" ? "Non-AI / Unattributed" : "非 AI / 未识别"}</option>
                {channelList.map((channel) => (
                  <option key={channel} value={channel}>
                    {channel}
                  </option>
                ))}
              </select>
              <span className={styles.smallBadge}>{language === "English" ? "Referrer + UTM + Tags + signals" : "Referrer + UTM + 标签 + signals"}</span>
            </div>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t(lang, "debug_table_order")}</th>
                  <th>{t(lang, "debug_table_time")}</th>
                  <th>{t(lang, "debug_table_ai_channel")}</th>
                  <th>{t(lang, "debug_table_gmv")}</th>
                  <th>{t(lang, "debug_table_ref_utm")}</th>
                  <th>{t(lang, "debug_table_detection")}</th>
                  <th>{t(lang, "debug_table_signals")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecentOrders.map((order) => (
                  <tr key={order.id}>
                    <td className={styles.cellLabel}>{order.name}</td>
                    <td>{timeFormatter.format(new Date(order.createdAt))}</td>
                    <td>{order.aiSource ?? "-"}</td>
                    <td>{fmtCurrency(order.totalPrice)}</td>
                    <td>
                      <div className={styles.debugCol}>
                        <span>referrer: {order.referrer || "—"}</span>
                        <span>source_name: {order.sourceName || "—"}</span>
                        <span>utm_source: {order.utmSource || "—"}</span>
                        <span>utm_medium: {order.utmMedium || "—"}</span>
                      </div>
                    </td>
                    <td>{order.detection}</td>
                    <td>
                      <ul className={styles.signalList}>
                        {(order.signals || []).map((signal, index) => (
                          <li key={`${order.id}-${index}`}>{signal}</li>
                        ))}
                        {(!order.signals || order.signals.length === 0) && <li>—</li>}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.helpText}>
            {language === "English" ? "If attribution looks off, adjust AI domains and UTM mapping in Settings / Rules & Export. All results are conservative estimates." : "若识别结果与预期不符，可在「设置 / 规则 & 导出」中调整 AI 域名与 UTM 映射；所有结果均为保守估计。"}
          </p>
        </div>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
