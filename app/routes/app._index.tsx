import { useCallback, useEffect, useMemo, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useFetcher, useLoaderData, useLocation, useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { channelList, defaultSettings, timeRanges, type TimeRangeKey, LOW_SAMPLE_THRESHOLD } from "../lib/aiData";
import { downloadFromApi } from "../lib/downloadUtils";
import { getSettings, syncShopPreferences } from "../lib/settings.server";
import { authenticate } from "../shopify.server";
import { useUILanguage } from "../lib/useUILanguage";
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
import { getEffectivePlan, hasFeature, FEATURES } from "../lib/access.server";
import { isDemoMode } from "../lib/runtime.server";
import { readAppFlags } from "../lib/env.server";
import { logger } from "../lib/logger.server";

// Dashboard 子组件
import { 
  KPICards, 
  ChannelBreakdown, 
  TrendChart,
  WhyAI,
  type Lang,
  type TrendScope,
  type JobSnapshot,
} from "../components/dashboard";

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

  const shopDomain = session?.shop || "";
  const url = new URL(request.url);

  let settings = await getSettings(shopDomain);
  // Only use admin if authentication succeeded
  if (admin && shopDomain && !authFailed) {
    try {
      settings = await syncShopPreferences(admin, shopDomain, settings);
    } catch (e) {
      // If sync fails, continue with cached settings
      logger.warn("[dashboard] syncShopPreferences failed", { shopDomain }, { error: e });
    }
  }

  const plan = await getEffectivePlan(shopDomain);
  const isFreePlan = plan === "free";
  const canViewFull = await hasFeature(shopDomain, FEATURES.DASHBOARD_FULL);

  // Enforce 7d limit for Free plan
  const defaultRangeKey: TimeRangeKey = isFreePlan ? "7d" : DEFAULT_RANGE_KEY;

  await ensureRetentionOncePerDay(shopDomain, settings);

  const context = await loadDashboardContext({
    shopDomain,
    admin, // admin can be null in demo mode
    settings,
    url,
    defaultRangeKey,
    includeBackfillState: true,
  });

  const { data } = await getAiDashboardData(shopDomain, context.dateRange, settings, {
    timezone: context.displayTimezone,
    allowDemo: context.dataSource === "demo",
    orders: context.orders,
  });

  const { showDebugPanels } = readAppFlags();

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
    isFreePlan,
    canViewFull,
    showDebugPanels, // 控制是否显示调试面板
  };
};

// 格式化工具函数
const fmtNumber = (value: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);

const fmtPercent = (value: number, fractionDigits = 1) =>
  `${(value * 100).toFixed(fractionDigits)}%`;

type JobStatus = "queued" | "processing" | "completed" | "failed";

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
    isFreePlan,
    canViewFull,
    showDebugPanels
  } = useLoaderData<typeof loader>();
  
  const uiLanguage = useUILanguage(language);
  const lang = uiLanguage as Lang;
  const navigate = useNavigate();
  const location = useLocation();
  const shopify = useAppBridge();

  const handleDownload = async (e: React.MouseEvent<HTMLAnchorElement | HTMLButtonElement>, url: string, fallbackFilename: string) => {
    e.preventDefault();
    const success = await downloadFromApi(
      url,
      fallbackFilename,
      () => shopify.idToken()
    );
    if (!success) {
      shopify.toast.show?.(uiLanguage === "English" ? "Download failed. Please try again." : "下载失败，请重试。");
    }
  };

  // 注意：metricView, trendMetric, trendScope 已移至各子组件内部管理
  const [customFrom, setCustomFrom] = useState(
    (dateRange.fromParam as string | undefined) || dateRange.start.slice(0, 10),
  );
  const [customTo, setCustomTo] = useState(
    (dateRange.toParam as string | undefined) || dateRange.end.slice(0, 10),
  );
  const [debugOrderFilter, setDebugOrderFilter] = useState("");
  const [debugChannelFilter, setDebugChannelFilter] = useState<"" | TrendScope>("");
  const locale = uiLanguage === "English" ? "en-US" : "zh-CN";
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
    (iso?: string | null) => (iso ? timeFormatter.format(new Date(iso)) : (uiLanguage === "English" ? "None" : "暂无")),
    [timeFormatter, uiLanguage],
  );

  useEffect(() => {
    setCustomFrom((dateRange.fromParam as string | undefined) || dateRange.start.slice(0, 10));
    setCustomTo((dateRange.toParam as string | undefined) || dateRange.end.slice(0, 10));
  }, [dateRange.end, dateRange.fromParam, dateRange.start, dateRange.toParam]);

  const backfillFetcher = useFetcher<{ ok: boolean; queued: boolean; reason?: string; range?: string }>();
  const jobFetcher = useFetcher<JobSnapshot>();

  useEffect(() => {
    let lastPollTime = 0;
    const MIN_POLL_INTERVAL = 5000; // 最小轮询间隔 5 秒，防止 429
    
    const poll = () => {
      if (document.visibilityState !== "visible") return;
      if (jobFetcher.state === "loading") return;
      
      const now = Date.now();
      if (now - lastPollTime < MIN_POLL_INTERVAL) return;
      
      lastPollTime = now;
      jobFetcher.load("/api/jobs");
    };
    
    // 延迟首次轮询，避免与页面加载同时发生
    // 使用 number 类型因为浏览器环境中 setTimeout/setInterval 返回 number
    let initialTimer: number | null = window.setTimeout(poll, 1000);
    let intervalTimer: number | null = window.setInterval(poll, 12000);
    let visibilityDelayTimer: number | null = null;
    
    const clearAllTimers = () => {
      if (initialTimer) {
        clearTimeout(initialTimer);
        initialTimer = null;
      }
      if (intervalTimer) {
        clearInterval(intervalTimer);
        intervalTimer = null;
      }
      if (visibilityDelayTimer) {
        clearTimeout(visibilityDelayTimer);
        visibilityDelayTimer = null;
      }
    };
    
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        // 清除所有现有的定时器，防止重复
        clearAllTimers();
        // 延迟一下再轮询，避免快速切换标签页时触发过多请求
        visibilityDelayTimer = window.setTimeout(() => {
          poll();
          visibilityDelayTimer = null;
        }, 500) as number;
        intervalTimer = window.setInterval(poll, 12000) as number;
      } else {
        // 页面不可见时清除所有定时器
        clearAllTimers();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearAllTimers();
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

  // 注意：trendScopes, channelMax, getTrendValue, trendScopeLabel, trendMax 已移至子组件内部管理

  const setRange = (value: TimeRangeKey) => {
    if (isFreePlan && value !== "7d") {
        // Show upgrade toast instead of alert
        shopify.toast.show?.(uiLanguage === "English" ? "Upgrade to Pro to view more history." : "升级到 Pro 版以查看更多历史数据。");
        return;
    }
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
    if (uiLanguage === "English") {
      if (key === "7d") return "Last 7 days";
      if (key === "30d") return "Last 30 days";
      if (key === "90d") return "Last 90 days";
      if (key === "custom") return "Custom";
    }
    return timeRanges[key].label;
  };

  const applyCustomRange = () => {
    if (isFreePlan) {
        shopify.toast.show?.(uiLanguage === "English" ? "Upgrade to Pro to use custom ranges." : "升级到 Pro 版以使用自定义时间范围。");
        return;
    }
    if (!customFrom) return;
    const params = new URLSearchParams(location.search);
    params.set("range", "custom");
    params.set("from", customFrom);
    params.set("to", customTo || customFrom);
    navigate({ search: `?${params.toString()}` });
  };
  
  const UpgradeOverlay = () => (
     <div style={{
         position: "absolute",
         top: 0, left: 0, right: 0, bottom: 0,
         background: "rgba(255,255,255,0.7)",
         backdropFilter: "blur(2px)",
         display: "flex",
         alignItems: "center",
         justifyContent: "center",
         zIndex: 10
     }}>
         <div style={{ background: "white", padding: 20, borderRadius: 8, boxShadow: "0 2px 10px rgba(0,0,0,0.1)", textAlign: "center" }}>
             <h3>{uiLanguage === "English" ? "Pro Feature" : "Pro 功能"}</h3>
             <p>{uiLanguage === "English" ? "Upgrade to see detailed LTV and product analysis." : "升级以查看 LTV 与产品详情。"}</p>
             <Link to="/app/onboarding?step=plan_selection" className={styles.primaryButton}>
                 {uiLanguage === "English" ? "Upgrade" : "去升级"}
             </Link>
         </div>
     </div>
  );

  return (
    <s-page heading={uiLanguage === "English" ? "AI Discovery & Attribution" : "AI 渠道基础仪表盘"}>
      <div className={styles.page}>
        
        {isFreePlan && (
            <div style={{ 
                background: "#e6f7ff", 
                border: "1px solid #91d5ff", 
                padding: "10px 16px", 
                marginBottom: 16, 
                borderRadius: 4,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center"
            }}>
                <span style={{ color: "#0050b3" }}>
                    {uiLanguage === "English" ? "You are on the Free plan (Limited to 7 days history)." : "当前为免费版（仅限查看最近 7 天数据）。"}
                </span>
                <Link to="/app/onboarding?step=plan_selection" style={{ color: "#0050b3", fontWeight: "bold", textDecoration: "underline" }}>
                    {uiLanguage === "English" ? "Upgrade to Pro" : "升级到 Pro 版"}
                </Link>
            </div>
        )}
      
        <div className={styles.pageHeader}>
          <div className={styles.titleBlock}>
            <div className={styles.badgeRow}>
              <span className={styles.badge}>{t(lang, "badge_v01")}</span>
              <span className={styles.badgeSecondary}>{t(lang, "badge_conservative_orders")}</span>
              {isLowSample && (
                <span className={styles.badgeSecondary}>
                  {uiLanguage === "English" ? `Sample < ${LOW_SAMPLE_THRESHOLD} · metrics for reference only` : `样本 < ${LOW_SAMPLE_THRESHOLD} · 指标仅供参考`}
                </span>
              )}
            </div>
            <h1 className={styles.heading}>{t(lang, "dashboard_title")}</h1>
            <p className={styles.subheading}>{t(lang, "dashboard_subheading")}</p>
            <div className={styles.warning}>
              <strong>{uiLanguage === "English" ? "Note:" : "说明："}</strong>{t(lang, "dashboard_warning")}
            </div>
            <div className={styles.metaRow}>
              <span>{t(lang, "meta_synced_at")}{timeFormatter.format(new Date(overview.lastSyncedAt))}</span>
              <span>
                {t(lang, "meta_updated_at")}{dataLastUpdated ? timeFormatter.format(new Date(dataLastUpdated)) : (uiLanguage === "English" ? "None" : "暂无")}
                {backfillSuppressed && (uiLanguage === "English" ? " (Backfilled within 30 minutes; using cached data)" : "（30 分钟内已补拉，复用缓存数据）")}
                {backfillAvailable && (uiLanguage === "English" ? " (Manual backfill available)" : "（可手动触发后台补拉）")}
              </span>
              <span>{t(lang, "meta_range")}{dateRange.label}</span>
              <span>
                {t(lang, "meta_metric_scope")} {gmvMetric} · {uiLanguage === "English" ? "New Customers = first-order customers (window)" : "新客=首单客户（仅限当前时间范围）"} · {uiLanguage === "English" ? "GMV computed from order fields" : "GMV 仅基于订单字段"}
              </span>
              <span>
                {t(lang, "meta_data_source")}
                {dataSource === "live"
                  ? (uiLanguage === "English" ? "Shopify Live Orders" : "Shopify 实时订单")
                  : dataSource === "stored"
                    ? (uiLanguage === "English" ? "Stored Orders" : "已缓存的店铺订单")
                    : dataSource === "demo"
                      ? (uiLanguage === "English" ? "Demo samples (no AI orders found)" : "Demo 样例（未检索到 AI 订单）")
                      : (uiLanguage === "English" ? "No data (demo disabled)" : "暂无数据（未启用演示数据）")}
                {uiLanguage === "English" ? " (live=API, stored=cached, demo=samples)" : "（live=实时 API，stored=本地缓存，demo=演示数据）"}
              </span>
              {clamped && <span>{uiLanguage === "English" ? `Hint: truncated to latest ${MAX_DASHBOARD_ORDERS} orders.` : `提示：已截断为最近 ${MAX_DASHBOARD_ORDERS} 笔订单样本。`}</span>}
              <span>
                {t(lang, "meta_timezones_currency")}{calculationTimezone} · {uiLanguage === "English" ? "Display TZ" : "展示时区"}：{timezone} · {uiLanguage === "English" ? "Currency" : "货币"}：{currency}
              </span>
            </div>
            <details className={styles.statusBlock}>
              <summary>{t(lang, "status_ops")}</summary>
              <div className={styles.pipelineRow}>
                <span>{uiLanguage === "English" ? "Webhook:" : "Webhook："}{fmtTime(pipeline.lastOrdersWebhookAt)}</span>
                <span>{uiLanguage === "English" ? "Backfill:" : "补拉："}{fmtTime(pipeline.lastBackfillAt)}</span>
                <span>{uiLanguage === "English" ? "Tagging:" : "标签："}{fmtTime(pipeline.lastTaggingAt)}</span>
                <div className={styles.statusChips}>
                  {(pipeline.statuses || []).map((item) => {
                    // 状态标签的国际化翻译
                    const titleTranslations: Record<string, string> = {
                      "orders/create webhook": uiLanguage === "English" ? "orders/create webhook" : "订单创建 Webhook",
                      "Hourly backfill (last 90 days)": uiLanguage === "English" ? "Hourly backfill (last 90 days)" : "每小时补拉（最近 90 天）",
                      "AI tagging write-back": uiLanguage === "English" ? "AI tagging write-back" : "AI 标签回写",
                    };
                    const statusTranslations: Record<string, string> = {
                      "healthy": uiLanguage === "English" ? "healthy" : "正常",
                      "warning": uiLanguage === "English" ? "warning" : "警告",
                      "info": uiLanguage === "English" ? "info" : "信息",
                    };
                    const displayTitle = titleTranslations[item.title] || item.title;
                    const displayStatus = statusTranslations[item.status] || item.status;
                    return (
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
                        {displayTitle}: {displayStatus}
                    </span>
                    );
                  })}
                </div>
                {backfillAvailable && (
                  <div className={styles.backfillRow}>
                    <button
                      className={styles.primaryButton}
                      onClick={triggerBackfill}
                      disabled={backfillFetcher.state !== "idle"}
                    >
                      {backfillFetcher.state === "idle" ? (uiLanguage === "English" ? "Backfill in background" : "后台补拉") : (uiLanguage === "English" ? "Backfilling..." : "后台补拉中...")}
                    </button>
                    {backfillFetcher.data && (
                      <span className={styles.backfillStatus}>
                        {backfillFetcher.data.queued
                          ? (uiLanguage === "English" ? `Background task triggered (${backfillFetcher.data.range})` : `已触发后台任务（${backfillFetcher.data.range}）`)
                          : backfillFetcher.data.reason === "in-flight"
                            ? (uiLanguage === "English" ? "A backfill is already running; refresh later" : "已有补拉在进行中，稍后刷新")
                            : (uiLanguage === "English" ? "Cannot trigger backfill; check shop session" : "无法触发补拉，请确认店铺会话")}
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
                {uiLanguage === "English" ? "No identifiable AI orders in this shop. Showing demo data. Check time range, referrer/UTM rules, or extend the window and retry." : "当前店铺暂无可识别的 AI 渠道订单，以下为演示数据。可检查时间范围、referrer/UTM 规则，或延长观测窗口后再试。"}
              </div>
            )}
            {dataSource === "empty" && (
              <div className={styles.warning}>
                {uiLanguage === "English" ? "No qualifying orders found and demo is disabled. Wait for webhook/backfill or extend the time range and retry." : "暂未检索到符合条件的订单，且已关闭演示数据。可等待 webhook/backfill 完成或延长时间范围后重试。"}
              </div>
            )}
            {overview.aiOrders === 0 && overview.totalOrders > 0 && (
              <div className={styles.callout}>
                <span>{uiLanguage === "English" ? "Hint" : "提示"}</span>
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
                    className={`${styles.pill} ${range === key ? styles.pillActive : ""} ${isFreePlan && key !== "7d" ? styles.pillDisabled : ""}`}
                    onClick={() => setRange(key)}
                    type="button"
                    disabled={isFreePlan && key !== "7d"}
                    style={isFreePlan && key !== "7d" ? { opacity: 0.5, cursor: "not-allowed" } : {}}
                  >
                    {getRangeLabel(key)}{isFreePlan && key !== "7d" ? " 🔒" : ""}
                  </button>
                ))}
              </div>
              <div className={styles.customRange}>
                <input
                  type="date"
                  className={styles.input}
                  value={customFrom}
                  onChange={(event) => setCustomFrom(event.target.value)}
                  disabled={isFreePlan}
                />
                <span className={styles.rangeDivider}>{uiLanguage === "English" ? "to" : "至"}</span>
                <input
                  type="date"
                  className={styles.input}
                  value={customTo}
                  onChange={(event) => setCustomTo(event.target.value)}
                  disabled={isFreePlan}
                />
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={applyCustomRange}
                  disabled={isFreePlan}
                >
                  {uiLanguage === "English" ? "Apply Custom" : "应用自定义"}
                </button>
              </div>
              <div className={styles.actionButtons}>
                <Link to="/app/additional" className={styles.primaryButton}>
                  {uiLanguage === "English" ? "Settings / Rules & Export" : "设置 / 规则 & 导出"}
                </Link>
                <Link to="/app/optimization" className={styles.secondaryButton} style={{ background: "#635bff", color: "white", border: "none" }}>
                  {uiLanguage === "English" ? "🚀 AI Optimization" : "🚀 AI 优化建议"}
                </Link>
                <Link to="/app/funnel" className={styles.secondaryButton}>
                  {uiLanguage === "English" ? "📊 Funnel Analysis" : "📊 漏斗分析"}
                </Link>
                <Link to="/app/copilot" className={styles.secondaryButton}>
                  {uiLanguage === "English" ? "Copilot Q&A" : "Copilot 分析问答"}
                </Link>
                <a
                  className={styles.secondaryButton}
                  href={canViewFull ? `/api/export/orders?range=${range}&from=${encodeURIComponent(dateRange.fromParam || "")}&to=${encodeURIComponent(dateRange.toParam || "")}` : "#"}
                  onClick={(e) => {
                      if (!canViewFull) {
                          e.preventDefault();
                          shopify.toast.show?.(uiLanguage === "English" ? "Upgrade to Pro to export data." : "升级到 Pro 版以导出数据。");
                          return;
                      }
                      handleDownload(e, `/api/export/orders?range=${range}&from=${encodeURIComponent(dateRange.fromParam || "")}&to=${encodeURIComponent(dateRange.toParam || "")}`, `ai-orders-${range}.csv`);
                  }}
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
              <span className={styles.smallBadge}>{uiLanguage === "English" ? "Reference" : "参考"}</span>
            </div>
            <ul className={styles.helpList}>
            <li>{uiLanguage === "English" ? `GMV: aggregated by ${gmvMetric} (${gmvMetric === "subtotal_price" ? "excluding tax/shipping" : "including tax/shipping"}).` : `GMV：按设置的 ${gmvMetric} 字段汇总（当前为 ${gmvMetric === "subtotal_price" ? "不含税/运费" : "含税/运费"}）。`}</li>
            <li>{uiLanguage === "English" ? "AI GMV: only orders identified as AI channel." : "AI GMV：仅统计被识别为 AI 渠道的订单 GMV。"}</li>
            <li>{uiLanguage === "English" ? "LTV (if shown): historical accumulated GMV within window, no prediction." : "LTV（如展示）：当前为历史累积 GMV，不含预测。"}</li>
            </ul>
          </div>
        </div>

        {/* KPI 卡片组件 */}
        <KPICards 
          overview={overview} 
          lang={lang} 
          formatters={{ fmtCurrency, fmtNumber, fmtPercent, fmtTime }} 
        />
        {isLowSample && (
          <div className={styles.lowSampleNotice}>
            {uiLanguage === "English" ? `Sample < ${LOW_SAMPLE_THRESHOLD}, metrics for reference only; extend range for more stable trends.` : `样本 < ${LOW_SAMPLE_THRESHOLD}，所有指标仅供参考；延长时间范围后可获得更稳定的趋势。`}
          </div>
        )}

        <div className={styles.twoCol}>
          {/* 渠道分布组件 */}
          <ChannelBreakdown 
            channels={channels} 
            lang={lang} 
            formatters={{ fmtCurrency, fmtNumber, fmtPercent, fmtTime }} 
          />

          <div className={styles.card} style={{ position: "relative" }}>
             {!canViewFull && <UpgradeOverlay />}
             <div style={!canViewFull ? { filter: "blur(4px)", pointerEvents: "none" } : {}}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.sectionLabel}>{t(lang, "comparison_section_label")}</p>
                <h3 className={styles.sectionTitle}>{uiLanguage === "English" ? "Overall vs AI Channels" : "整体 vs 各 AI 渠道"}</h3>
              </div>
              {isLowSample ? (
                <span className={styles.smallBadge}>
                  {uiLanguage === "English" ? `Sample < ${LOW_SAMPLE_THRESHOLD} · interpret with caution` : `样本 < ${LOW_SAMPLE_THRESHOLD} · 解读时请谨慎`}
                </span>
              ) : (
                <span className={styles.smallBadge}>{uiLanguage === "English" ? `Sample >= ${LOW_SAMPLE_THRESHOLD}` : `样本 >= ${LOW_SAMPLE_THRESHOLD}`}</span>
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
                  {comparison.map((row) => {
                    // 翻译渠道名称
                    const channelName = row.channel === "整体" 
                      ? (uiLanguage === "English" ? "Overall" : "整体")
                      : row.channel;
                    return (
                    <tr key={row.channel}>
                      <td className={styles.cellLabel}>
                        {channelName}
                        {row.isLowSample && <span className={styles.chip}>{uiLanguage === "English" ? "Low sample" : "样本少"}</span>}
                      </td>
                      <td>{fmtCurrency(row.aov)}</td>
                      <td>{fmtPercent(row.newCustomerRate)}</td>
                      <td>{fmtPercent(row.repeatRate)}</td>
                      <td>{fmtNumber(row.sampleSize)}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {sampleNote && <p className={styles.warning}>{sampleNote}</p>}
             </div>
          </div>
        </div>

        <div className={styles.twoCol}>
          <div className={styles.card} style={{ position: "relative" }}>
             {!canViewFull && <UpgradeOverlay />}
             <div style={!canViewFull ? { filter: "blur(4px)", pointerEvents: "none" } : {}}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.sectionLabel}>{uiLanguage === "English" ? "Customers" : "客户维度"}</p>
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
            <p className={styles.helpText}>{uiLanguage === "English" ? "LTV aggregated by GMV within window; good for spotting high-value customers." : "窗口内按 GMV 汇总的 LTV，适合观察高价值客户分布。"}</p>
            </div>
          </div>
        </div>

        <div className={styles.twoCol}>
          {/* 趋势图组件 */}
          <TrendChart 
            trend={trend} 
            lang={lang} 
            formatters={{ fmtCurrency, fmtNumber, fmtPercent, fmtTime }} 
          />

        <div className={styles.card} style={{ position: "relative" }}>
             {!canViewFull && <UpgradeOverlay />}
             <div style={!canViewFull ? { filter: "blur(4px)", pointerEvents: "none" } : {}}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.sectionLabel}>{uiLanguage === "English" ? "Products" : "产品维度"}</p>
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
                    <th>{uiLanguage === "English" ? "Product ID / Handle" : "产品 ID / Handle"}</th>
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
              {uiLanguage === "English" ? "Scope: products appearing in AI-channel orders; Share = AI-channel orders / total orders of product." : "统计口径：含 AI 渠道订单中出现过的产品；占比=AI 渠道订单数 / 产品总订单数。"}
            </p>
          </div>
          </div>
        </div>

        {/* 任务状态面板 - 仅在 SHOW_DEBUG_PANELS=true 时显示 */}
        {showDebugPanels && (
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
                <h4>{uiLanguage === "English" ? "Backfill" : "补拉"}</h4>
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
                      <th>{uiLanguage === "English" ? "Range" : "范围"}</th>
                      <th>{uiLanguage === "English" ? "Status" : "状态"}</th>
                      <th>{uiLanguage === "English" ? "Orders Fetched" : "拉取订单"}</th>
                      <th>{uiLanguage === "English" ? "Started" : "开始"}</th>
                      <th>{uiLanguage === "English" ? "Finished" : "结束"}</th>
                      <th>{uiLanguage === "English" ? "Error" : "错误"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(jobFetcher.data?.backfills.recent || []).map((job) => (
                      <tr key={job.id}>
                        <td>{job.id}</td>
                        <td>{job.range}</td>
                        <td>{job.status}</td>
                        <td>{job.ordersFetched}</td>
                        <td>{job.startedAt ? fmtTime(job.startedAt) : (uiLanguage === "English" ? "Pending" : "待开始")}</td>
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
                <h4>{uiLanguage === "English" ? "Order Webhook Queue" : "订单 Webhook 队列"}</h4>
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
                      <th>{uiLanguage === "English" ? "Status" : "状态"}</th>
                      <th>{uiLanguage === "English" ? "Started" : "开始"}</th>
                      <th>{uiLanguage === "English" ? "Finished" : "结束"}</th>
                      <th>{uiLanguage === "English" ? "Error" : "错误"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(jobFetcher.data?.webhooks.recent || []).map((job) => (
                      <tr key={job.id}>
                        <td>{job.id}</td>
                        <td>{job.topic}</td>
                        <td>{job.intent}</td>
                        <td>{job.status}</td>
                        <td>{job.startedAt ? fmtTime(job.startedAt) : (uiLanguage === "English" ? "Pending" : "待开始")}</td>
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
            {uiLanguage === "English" ? "Data from /api/jobs; useful for diagnosing queue backlogs and retries across instances." : "数据来源于 /api/jobs，可用于多实例场景下排查队列堆积、失败重试等问题。"}
          </p>
        </div>
        )}

        {/* 调试视图面板 - 仅在 SHOW_DEBUG_PANELS=true 时显示 */}
        {showDebugPanels && (
        <div className={styles.card}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.sectionLabel}>{t(lang, "debug_section_label")}</p>
              <h3 className={styles.sectionTitle}>{t(lang, "debug_section_title")}</h3>
            </div>
            <div className={styles.debugFilters}>
              <input
                type="search"
                placeholder={uiLanguage === "English" ? "Filter by order name / ID / channel" : "按订单号 / ID / 渠道过滤"}
                value={debugOrderFilter}
                onChange={(event) => setDebugOrderFilter(event.target.value)}
                className={styles.searchInput}
              />
              <select
                value={debugChannelFilter || ""}
                onChange={(event) => setDebugChannelFilter(event.target.value as TrendScope | "")}
                className={styles.select}
              >
                <option value="">{uiLanguage === "English" ? "All" : "全部"}</option>
                <option value="ai">{uiLanguage === "English" ? "AI Channels" : "AI 渠道"}</option>
                <option value="overall">{uiLanguage === "English" ? "Non-AI / Unattributed" : "非 AI / 未识别"}</option>
                {channelList.map((channel) => (
                  <option key={channel} value={channel}>
                    {channel}
                  </option>
                ))}
              </select>
              <span className={styles.smallBadge}>{uiLanguage === "English" ? "Referrer + UTM + Tags + signals" : "Referrer + UTM + 标签 + signals"}</span>
            </div>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t(lang, "debug_table_order")}</th>
                  <th>{t(lang, "debug_table_time")}</th>
                  <th>{uiLanguage === "English" ? "AI Channel & Evidence" : "AI 渠道 & 证据"}</th>
                  <th>{t(lang, "debug_table_gmv")}</th>
                  <th>{t(lang, "debug_table_ref_utm")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecentOrders.map((order) => (
                  <tr key={order.id}>
                    <td className={styles.cellLabel}>{order.name}</td>
                    <td>{timeFormatter.format(new Date(order.createdAt))}</td>
                    <td style={{ minWidth: 200 }}>
                      <WhyAI
                        aiSource={order.aiSource}
                        referrer={order.referrer}
                        utmSource={order.utmSource}
                        utmMedium={order.utmMedium}
                        sourceName={order.sourceName}
                        detection={order.detection}
                        signals={order.signals}
                        lang={lang}
                      />
                    </td>
                    <td>{fmtCurrency(order.totalPrice)}</td>
                    <td>
                      <div className={styles.debugCol}>
                        <span>referrer: {order.referrer || "—"}</span>
                        <span>source_name: {order.sourceName || "—"}</span>
                        <span>utm_source: {order.utmSource || "—"}</span>
                        <span>utm_medium: {order.utmMedium || "—"}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.helpText}>
            {uiLanguage === "English" ? "If attribution looks off, adjust AI domains and UTM mapping in Settings / Rules & Export. All results are conservative estimates." : "若识别结果与预期不符，可在「设置 / 规则 & 导出」中调整 AI 域名与 UTM 映射；所有结果均为保守估计。"}
          </p>
        </div>
        )}
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
