import { useCallback, useEffect, useMemo, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useFetcher, useLoaderData, useLocation, useNavigate, useRevalidator } from "react-router";
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
  BACKFILL_STALE_THRESHOLD_SECONDS,
} from "../lib/constants";
import { loadDashboardContext } from "../lib/dashboardContext.server";
import { t } from "../lib/i18n";
import { getEffectivePlan, hasFeature, FEATURES } from "../lib/access.server";
import { isDemoMode } from "../lib/runtime.server";
import { readAppFlags } from "../lib/env.server";
import { logger } from "../lib/logger.server";
import { generateAIOptimizationReport } from "../lib/aiOptimization.server";
import { isProductSchemaEmbedEnabled } from "../lib/themeEmbedStatus.server";

// Dashboard 子组件
import { 
  KPICards, 
  ChannelBreakdown, 
  TrendChart,
  WhyAI,
  LowSampleNotice,
  UpgradePrompt,
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
  const visibilityLanguage = settings.languages?.[0] || "中文";
  const visibilityEmbedEnabled =
    admin && shopDomain && !authFailed ? await isProductSchemaEmbedEnabled(admin, shopDomain) : null;
  const visibilityReport = shopDomain
    ? await generateAIOptimizationReport(shopDomain, admin ?? undefined, {
        range: "30d",
        language: visibilityLanguage,
        exposurePreferences: settings.exposurePreferences,
        embedEnabled: visibilityEmbedEnabled,
      })
    : null;
  const visibilityEnabledTypes = [
    settings.exposurePreferences.exposeProducts ? "products" : null,
    settings.exposurePreferences.exposeCollections ? "collections" : null,
    settings.exposurePreferences.exposeBlogs ? "blogs" : null,
  ].filter((value): value is string => Boolean(value));
  const llmsCoverage = visibilityReport?.llmsEnhancements.currentCoverage ?? 0;
  const llmsStatus: VisibilityStatus =
    llmsCoverage >= 100 ? "active" : llmsCoverage > 0 ? "partial" : "inactive";
  const schemaStatus: VisibilityStatus =
    visibilityEmbedEnabled === true ? "active" : visibilityEmbedEnabled === false ? "inactive" : "unknown";
  const visibilityTopSuggestion =
    visibilityReport?.suggestions.find((suggestion) => suggestion.priority === "high") ??
    visibilityReport?.suggestions[0] ??
    null;

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
      lastBackfillAttemptAt: settings.lastBackfillAttemptAt || null,
      lastBackfillOrdersFetched: settings.lastBackfillOrdersFetched ?? null,
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
    backfillStaleThresholdSeconds: BACKFILL_STALE_THRESHOLD_SECONDS, // 供前端判断任务是否卡住
    visibility: {
      overallScore: visibilityReport?.overallScore ?? 0,
      llmsCoverage,
      llmsStatus,
      schemaStatus,
      enabledTypes: visibilityEnabledTypes,
      llmsPublicUrl: shopDomain ? `https://${shopDomain}/a/llms` : null,
      topSuggestion: visibilityTopSuggestion
        ? {
            title:
              visibilityLanguage === "English"
                ? visibilityTopSuggestion.title.en
                : visibilityTopSuggestion.title.zh,
            priority: visibilityTopSuggestion.priority,
          }
        : null,
    },
  };
};

// 格式化工具函数
const fmtNumber = (value: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);

const fmtPercent = (value: number, fractionDigits = 1) =>
  `${(value * 100).toFixed(fractionDigits)}%`;

type JobStatus = "queued" | "processing" | "completed" | "failed";
type VisibilityStatus = "active" | "partial" | "inactive" | "unknown";

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
    showDebugPanels,
    backfillStaleThresholdSeconds,
    visibility,
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
  const visibilityStatusMeta = useMemo<Record<VisibilityStatus, { label: string; className: string }>>(
    () => ({
      active: {
        label: uiLanguage === "English" ? "Active" : "已启用",
        className: styles.visibilityStatusActive,
      },
      partial: {
        label: uiLanguage === "English" ? "Partial" : "部分启用",
        className: styles.visibilityStatusPartial,
      },
      inactive: {
        label: uiLanguage === "English" ? "Not configured" : "未配置",
        className: styles.visibilityStatusInactive,
      },
      unknown: {
        label: uiLanguage === "English" ? "Needs check" : "待检查",
        className: styles.visibilityStatusUnknown,
      },
    }),
    [uiLanguage],
  );
  const visibleTypeLabels = useMemo(
    () =>
      visibility.enabledTypes.map((type) => {
        if (type === "products") return uiLanguage === "English" ? "Products" : "产品页";
        if (type === "collections") return uiLanguage === "English" ? "Collections" : "合集页";
        return uiLanguage === "English" ? "Blogs" : "博客页";
      }),
    [uiLanguage, visibility.enabledTypes],
  );

  useEffect(() => {
    setCustomFrom((dateRange.fromParam as string | undefined) || dateRange.start.slice(0, 10));
    setCustomTo((dateRange.toParam as string | undefined) || dateRange.end.slice(0, 10));
  }, [dateRange.end, dateRange.fromParam, dateRange.start, dateRange.toParam]);

  // apiSuccess 包装响应为 { ok: true, data: { queued, reason, range } }
  type BackfillData = { queued: boolean; reason?: string; range?: string };
  type BackfillResponse = { ok: boolean; data?: BackfillData; error?: { code: string; message: string } };
  const backfillFetcher = useFetcher<BackfillResponse>();
  // 解包 apiSuccess 的 data 字段
  const backfillData = backfillFetcher.data?.ok ? backfillFetcher.data.data : undefined;
  const jobFetcher = useFetcher<JobSnapshot>();
  const revalidator = useRevalidator();
  
  // 【修复】动态计算 backfill 是否可用，基于轮询数据而非 loader 静态数据
  // 这样用户不需要刷新页面，按钮会自动恢复可用
  const backfills = useMemo(() => jobFetcher.data?.backfills?.recent || [], [jobFetcher.data]);
  
  // 【修复】检查任务是否真的在活动（而不是卡住了）
  // 后端已在 api.jobs 返回前清理卡住任务，这里是前端的保底判断
  const isJobActive = (job: { status?: unknown; createdAt?: unknown; startedAt?: unknown }) => {
    if (job.status !== "processing" && job.status !== "queued") return false;
    const now = Date.now();
    const staleMs = backfillStaleThresholdSeconds * 1000;
    // processing 状态检查 startedAt，queued 状态检查 createdAt
    const timestampStr = job.status === "processing" 
      ? (job.startedAt as string | null) || (job.createdAt as string)
      : (job.createdAt as string);
    if (!timestampStr) return false;
    const timestamp = new Date(timestampStr).getTime();
    return now - timestamp < staleMs;
  };
  
  const isBackfillProcessing = backfills.some(isJobActive);
  // 如果 jobFetcher 有数据，用它判断；否则用 loader 的初始值
  const dynamicBackfillAvailable = jobFetcher.data ? !isBackfillProcessing : backfillAvailable;
  
  // 【优化 4】追踪 backfill 任务状态，完成后自动刷新
  const [prevBackfillProcessing, setPrevBackfillProcessing] = useState(false);
  
  useEffect(() => {
    // 检测从 processing/queued 变为 completed 的状态变化
    if (prevBackfillProcessing && !isBackfillProcessing && backfills.length > 0) {
      const latestJob = backfills[0];
      if (latestJob.status === "completed" && latestJob.ordersFetched > 0) {
        // 有新数据，触发页面刷新
        revalidator.revalidate();
      }
    }
    
    setPrevBackfillProcessing(isBackfillProcessing);
  }, [backfills, isBackfillProcessing, prevBackfillProcessing, revalidator]);

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
    // 【优化 5】支持自定义日期范围的 backfill
    // 当 range=custom 时，传递 from/to 参数给后端
    if (range === "custom" && dateRange.fromParam && dateRange.toParam) {
      backfillFetcher.submit(
        { 
          range: "custom",
          from: dateRange.fromParam as string,
          to: dateRange.toParam as string,
        },
        { method: "post", action: "/api/backfill" },
      );
    } else {
      // 预设范围（7d/30d/90d）
      backfillFetcher.submit(
        { range },
        { method: "post", action: "/api/backfill" },
      );
    }
  }, [backfillFetcher, range, dateRange.fromParam, dateRange.toParam]);

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
  const hasAnyData = dataSource === "live" || dataSource === "stored" || dataSource === "demo";
  const isLowSample = hasAnyData && overview.aiOrders > 0 && overview.aiOrders < LOW_SAMPLE_THRESHOLD;

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
  
  // 使用新的 UpgradePrompt 组件替代原有的 UpgradeOverlay

  return (
    <s-page heading={uiLanguage === "English" ? "AI Revenue & Visibility" : "AI 收入归因与可见性"}>
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
                <Link to="/app/billing" style={{ color: "#0050b3", fontWeight: "bold", textDecoration: "underline" }}>
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
            <h1 className={styles.heading}>
              {uiLanguage === "English" ? "See AI revenue first, then improve AI visibility" : "先看 AI 带单，再继续提升 AI 可见性"}
            </h1>
            <p className={styles.subheading}>
              {uiLanguage === "English"
                ? "Use this dashboard to prove GMV, orders and channel quality from AI traffic, then jump straight into llms.txt, Schema and FAQ optimization when you're ready to increase discovery."
                : "先用这个 Dashboard 证明 AI 流量带来了多少 GMV、订单和高意图转化；确认有效后，再直接进入 llms.txt、Schema 和 FAQ 优化，提升被 AI 推荐的概率。"}
            </p>
            <div className={styles.warning}>
              <strong>{uiLanguage === "English" ? "Note:" : "说明："}</strong>{t(lang, "dashboard_warning")}
            </div>
            <div className={styles.metaRow}>
              <span>{t(lang, "meta_synced_at")}{timeFormatter.format(new Date(overview.lastSyncedAt))}</span>
              <span>
                {t(lang, "meta_updated_at")}{dataLastUpdated ? timeFormatter.format(new Date(dataLastUpdated)) : (uiLanguage === "English" ? "None" : "暂无")}
                {backfillSuppressed && (uiLanguage === "English" ? " (Backfilled within 30 minutes; using cached data)" : "（30 分钟内已补拉，复用缓存数据）")}
                {dynamicBackfillAvailable && (uiLanguage === "English" ? " (Manual backfill available)" : "（可手动触发后台补拉）")}
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
                <span>
                  {uiLanguage === "English" ? "Backfill:" : "补拉："}
                  {pipeline.lastBackfillAttemptAt 
                    ? `${fmtTime(pipeline.lastBackfillAttemptAt)} (${pipeline.lastBackfillOrdersFetched ?? 0} ${uiLanguage === "English" ? "orders" : "笔"})`
                    : (uiLanguage === "English" ? "None" : "暂无")}
                </span>
                <span>{uiLanguage === "English" ? "Tagging:" : "标签："}{fmtTime(pipeline.lastTaggingAt)}</span>
                <div className={styles.statusChips}>
                  {(pipeline.statuses || []).map((item) => {
                    // 状态标签的国际化翻译
                    const titleTranslations: Record<string, string> = {
                      "orders/create webhook": uiLanguage === "English" ? "orders/create webhook" : "订单创建 Webhook",
                      "Hourly backfill (last 60 days)": uiLanguage === "English" ? "Hourly backfill (last 60 days)" : "每小时补拉（最近 60 天）",
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
                <div className={styles.backfillRow}>
                  <button
                    className={styles.primaryButton}
                    onClick={triggerBackfill}
                    disabled={backfillFetcher.state !== "idle" || !dynamicBackfillAvailable}
                  >
                    {backfillFetcher.state === "idle"
                      ? (uiLanguage === "English" ? "Backfill in background" : "后台补拉")
                      : (uiLanguage === "English" ? "Backfilling..." : "后台补拉中...")}
                  </button>
                  {!dynamicBackfillAvailable && backfillFetcher.state === "idle" && (
                    <span className={styles.backfillStatus}>
                      {uiLanguage === "English" ? "A backfill task is running in background" : "后台补拉任务进行中"}
                    </span>
                  )}
                  {backfillData && (
                    <span className={styles.backfillStatus}>
                      {backfillData.queued
                        ? (uiLanguage === "English" ? `Background task triggered (${backfillData.range})` : `已触发后台任务（${backfillData.range}）`)
                        : backfillData.reason === "in-flight"
                          ? (uiLanguage === "English" ? "A backfill is already running; refresh later" : "已有补拉在进行中，稍后刷新")
                          : (uiLanguage === "English" ? "Cannot trigger backfill; check shop session" : "无法触发补拉，请确认店铺会话")}
                    </span>
                  )}
                </div>
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
                {uiLanguage === "English" 
                  ? "No qualifying orders found in the last 60 days (Shopify default limit). This may be a new store, or orders are older than 60 days. To access older orders, request 'read_all_orders' scope and re-authorize." 
                  : "最近 60 天内暂无符合条件的订单（Shopify 默认限制）。可能是新店铺，或订单都在 60 天之前。如需访问更早订单，请申请 read_all_orders 权限并重新授权。"}
                <Link to="/app/attribution" className={styles.link} style={{ marginLeft: 8 }}>
                  {uiLanguage === "English" ? "Fix Attribution" : "检查归因设置"}
                </Link>
              </div>
            )}
            {overview.aiOrders === 0 && overview.totalOrders > 0 && (
              <div className={styles.callout}>
                <span>{uiLanguage === "English" ? "Hint" : "提示"}</span>
                {t(lang, "hint_zero_ai")}
                <Link to="/app/attribution" className={styles.link}>
                  {uiLanguage === "English" ? "Fix Attribution" : "检查归因设置"}
                </Link>
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
                <Link to="/app/analytics" className={styles.primaryButton}>
                  {uiLanguage === "English" ? "View Analytics" : "查看分析"}
                </Link>
                <Link to="/app/discovery" className={styles.secondaryButton} style={{ background: "#f0f4ff", border: "1px solid #adc6ff", color: "#2f54eb" }}>
                  {uiLanguage === "English" ? "Improve Discovery" : "提升 AI 发现"}
                </Link>
                <Link to="/app/attribution" className={styles.secondaryButton} style={{ background: "#fff7e6", border: "1px solid #ffd591", color: "#d46b08" }}>
                  {uiLanguage === "English" ? "Fix Attribution" : "调整归因设置"}
                </Link>
                <Link to="/app/discovery?tab=recommendations" className={styles.secondaryButton}>
                  {uiLanguage === "English" ? "Full Discovery Report" : "完整发现优化报告"}
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

        </div>

        <div className={styles.card}>
          <div className={styles.visibilitySummary}>
            <div className={styles.visibilityIntro}>
              <div className={styles.sectionHeader}>
                <div>
                  <p className={styles.sectionLabel}>{uiLanguage === "English" ? "AI Visibility Snapshot" : "AI 可见性概览"}</p>
                  <h3 className={styles.sectionTitle}>
                    {uiLanguage === "English" ? "Track Revenue, Then Improve Discovery" : "先看 AI 带单，再提升 AI 推荐概率"}
                  </h3>
                </div>
                <span className={styles.smallBadge} style={{ background: "#eef6ff", color: "#1d4ed8" }}>
                  {uiLanguage === "English" ? "Homepage Summary" : "首页总览"}
                </span>
              </div>
              <p className={styles.helpText} style={{ marginTop: 0 }}>
                {uiLanguage === "English"
                  ? "This app already includes both AI attribution and AI SEO tooling. Use this block to move from revenue proof to llms.txt / Schema / FAQ optimization without leaving the dashboard context."
                  : "这个应用已经同时覆盖 AI 归因和 AI SEO 两条能力线。这个区块把“先证明 AI 带单”与“继续做 llms.txt / Schema / FAQ 优化”串在一起，避免首页只看到分析。"}
              </p>
              <div className={styles.visibilityBadges}>
                <span className={`${styles.statusChip} ${visibilityStatusMeta[visibility.llmsStatus].className}`}>
                  llms.txt: {visibilityStatusMeta[visibility.llmsStatus].label}
                </span>
                <span className={`${styles.statusChip} ${visibilityStatusMeta[visibility.schemaStatus].className}`}>
                  {uiLanguage === "English" ? "Schema Embed" : "Schema Embed"}: {visibilityStatusMeta[visibility.schemaStatus].label}
                </span>
                <span className={styles.statusChip}>
                  {uiLanguage === "English" ? "AI Visibility Score" : "AI 可见性评分"}: {visibility.overallScore}/100
                </span>
              </div>
              <div className={styles.visibilityKpis}>
                <div className={styles.visibilityStat}>
                  <span className={styles.visibilityStatLabel}>{uiLanguage === "English" ? "llms Coverage" : "llms 覆盖率"}</span>
                  <strong className={styles.visibilityStatValue}>{visibility.llmsCoverage}%</strong>
                </div>
                <div className={styles.visibilityStat}>
                  <span className={styles.visibilityStatLabel}>{uiLanguage === "English" ? "Exposed Types" : "已暴露内容"}</span>
                  <strong className={styles.visibilityStatValue}>
                    {visibleTypeLabels.length
                      ? visibleTypeLabels.join(" / ")
                      : uiLanguage === "English"
                        ? "None yet"
                        : "尚未开启"}
                  </strong>
                </div>
                <div className={styles.visibilityStat}>
                  <span className={styles.visibilityStatLabel}>{uiLanguage === "English" ? "Public llms.txt" : "公开 llms.txt"}</span>
                  <strong className={styles.visibilityStatValue}>
                    {visibility.llmsPublicUrl ? "/a/llms" : uiLanguage === "English" ? "Unavailable" : "不可用"}
                  </strong>
                </div>
              </div>
            </div>
            <div className={styles.visibilityActions}>
              <div className={styles.visibilityLinks}>
                <Link to="/app/discovery" className={styles.primaryButton}>
                  {uiLanguage === "English" ? "Open Discovery Workspace" : "打开发现优化工作台"}
                </Link>
                <Link to="/app/discovery" className={styles.secondaryButton}>
                  {uiLanguage === "English" ? "Configure llms.txt" : "配置 llms.txt"}
                </Link>
                <Link to="/app/discovery?tab=recommendations" className={styles.secondaryButton}>
                  {uiLanguage === "English" ? "View Discovery Report" : "查看发现优化报告"}
                </Link>
                {visibility.llmsPublicUrl && (
                  <a
                    className={styles.secondaryButton}
                    href={visibility.llmsPublicUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {uiLanguage === "English" ? "Open Live llms.txt" : "查看线上 llms.txt"}
                  </a>
                )}
              </div>
              {visibility.topSuggestion && (
                <div className={styles.visibilityRecommendation}>
                  <span className={styles.visibilityRecommendationLabel}>
                    {uiLanguage === "English" ? "Next best action" : "建议优先处理"}
                  </span>
                  <strong>
                    {visibility.topSuggestion.priority === "high"
                      ? `${uiLanguage === "English" ? "High" : "高优先级"}: `
                      : ""}
                    {visibility.topSuggestion.title}
                  </strong>
                </div>
              )}
            </div>
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

        {/* KPI 卡片组件 */}
        <KPICards 
          overview={overview} 
          lang={lang} 
          formatters={{ fmtCurrency, fmtNumber, fmtPercent, fmtTime }} 
        />
        {isLowSample && (
          <LowSampleNotice
            sampleCount={overview.aiOrders}
            threshold={LOW_SAMPLE_THRESHOLD}
            lang={lang}
            variant="banner"
            showTips={overview.aiOrders < LOW_SAMPLE_THRESHOLD / 2}
          />
        )}

        <div className={styles.twoCol}>
          {/* 渠道分布组件 */}
          <ChannelBreakdown 
            channels={channels} 
            lang={lang} 
            formatters={{ fmtCurrency, fmtNumber, fmtPercent, fmtTime }} 
          />

          <div className={styles.card} style={{ position: "relative" }}>
             {!canViewFull && <UpgradePrompt lang={lang} feature="ltv" variant="overlay" />}
             <div style={!canViewFull ? { filter: "blur(4px)", pointerEvents: "none" } : {}}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.sectionLabel}>{t(lang, "comparison_section_label")}</p>
                <h3 className={styles.sectionTitle}>{uiLanguage === "English" ? "Overall vs AI Channels" : "整体 vs 各 AI 渠道"}</h3>
              </div>
              {isLowSample ? (
                <LowSampleNotice
                  sampleCount={overview.aiOrders}
                  threshold={LOW_SAMPLE_THRESHOLD}
                  lang={lang}
                  variant="inline"
                />
              ) : (
                <span className={styles.smallBadge} style={{ background: "#e6f7ed", color: "#2e7d32" }}>
                  {uiLanguage === "English" ? `${overview.aiOrders} AI orders · reliable` : `${overview.aiOrders} 笔 AI 订单 · 数据可靠`}
                </span>
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
             {!canViewFull && <UpgradePrompt lang={lang} feature="ltv" variant="overlay" />}
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
             {!canViewFull && <UpgradePrompt lang={lang} feature="products" variant="overlay" />}
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
            {uiLanguage === "English" ? "If attribution looks off, open Attribution Settings to adjust AI domains and UTM mapping. All results are conservative estimates." : "若识别结果与预期不符，可前往「归因设置」调整 AI 域名与 UTM 映射；所有结果均为保守估计。"}
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
