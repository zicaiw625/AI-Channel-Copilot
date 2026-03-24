import { useCallback, useEffect, useMemo, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useFetcher, useLoaderData, useLocation, useNavigate, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { channelList, defaultSettings, timeRanges, type TimeRangeKey, LOW_SAMPLE_THRESHOLD } from "../lib/aiData";
import { getSettings, syncShopPreferences } from "../lib/settings.server";
import { authenticate } from "../shopify.server";
import { useUILanguage } from "../lib/useUILanguage";
import { resolveUILanguageFromRequest } from "../lib/language.server";
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
import { t, tp } from "../lib/i18n";
import { getEffectivePlan, hasFeature, FEATURES } from "../lib/access.server";
import { isDemoMode } from "../lib/runtime.server";
import { readAppFlags } from "../lib/env.server";
import { logger } from "../lib/logger.server";
import { getLlmsStatus } from "../lib/llms.server";
import { LlmsTxtPanel } from "../components/seo/LlmsTxtPanel";
import {
  buildAiVisibilityHref,
  buildAttributionHref,
  buildBillingHref,
  buildEmbeddedAppPath,
  buildOptimizationHref,
  buildUTMWizardHref,
  getPreservedSearchParams,
} from "../lib/navigation";

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
    // authenticate.admin 在缺少会话/需要 OAuth 时可能通过抛出 Response 触发重定向；
    // 仅在非 demo 模式放行，否则 demo 流程会被 OAuth/redirect 打断。
    if (error instanceof Response) {
      if (!_demo) throw error;
    }
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
  const canUseCopilot = await hasFeature(shopDomain, FEATURES.COPILOT);
  const canUseGrowthTools = await hasFeature(shopDomain, FEATURES.MULTI_STORE);
  const canManageLlms = await hasFeature(shopDomain, FEATURES.LLMS_BASIC);
  const canUseLlmsAdvanced = await hasFeature(shopDomain, FEATURES.LLMS_ADVANCED);
  const llmsStatus = await getLlmsStatus(shopDomain, settings);

  // 统一语言：优先使用 cookie `aicc_language`，避免首屏中英混排
  const resolvedLanguage = resolveUILanguageFromRequest(request, settings.languages?.[0] || "中文");

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
    language: resolvedLanguage,
  });

  const { data } = await getAiDashboardData(shopDomain, context.dateRange, settings, {
    timezone: context.displayTimezone,
    allowDemo: context.dataSource === "demo",
    orders: context.orders,
    language: resolvedLanguage,
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
    language: resolvedLanguage,
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
    canUseCopilot,
    canUseGrowthTools,
    canManageLlms,
    canUseLlmsAdvanced,
    shopDomain,
    llmsStatus: {
      status: llmsStatus.status,
      publicUrl: llmsStatus.publicUrl,
      cachedAt: llmsStatus.cachedAt?.toISOString() || null,
    },
    exposurePreferences: settings.exposurePreferences,
    showDebugPanels, // 控制是否显示调试面板
    backfillStaleThresholdSeconds: BACKFILL_STALE_THRESHOLD_SECONDS, // 供前端判断任务是否卡住
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
    timezone,
    language,
    clamped,
    backfillSuppressed,
    backfillAvailable,
    dataLastUpdated,
    isFreePlan,
    canViewFull,
    canUseCopilot,
    canUseGrowthTools,
    canManageLlms,
    canUseLlmsAdvanced,
    shopDomain,
    llmsStatus,
    exposurePreferences,
    showDebugPanels,
    backfillStaleThresholdSeconds,
  } = useLoaderData<typeof loader>();
  
  const uiLanguage = useUILanguage(language);
  const lang = uiLanguage as Lang;
  const navigate = useNavigate();
  const location = useLocation();
  const shopify = useAppBridge();

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
  const billingHref = buildBillingHref(location.search);
  const attributionHref = buildAttributionHref(location.search, { backTo: null, section: "attribution" });
  const diagnosticsHref = buildAttributionHref(location.search, {
    backTo: null,
    section: "diagnostics",
    clearWorkspaceContext: true,
  });
  const exportsHref = buildAttributionHref(location.search, {
    backTo: null,
    section: "export",
    clearWorkspaceContext: true,
  });
  const healthHref = buildAttributionHref(location.search, {
    backTo: null,
    section: "health",
    clearWorkspaceContext: true,
  });
  const optimizationHref = buildOptimizationHref(location.search, { backTo: "dashboard", fromTab: null });
  const copilotHref = buildEmbeddedAppPath("/app/copilot", location.search);
  const utmWizardHref = buildUTMWizardHref(location.search, { backTo: "dashboard" });
  const multiStoreHref = buildEmbeddedAppPath("/app/multi-store", location.search);
  const aiWorkspaceHref = buildAiVisibilityHref(location.search, { tab: "llms", fromTab: null, backTo: null });
  const webhookExportHref = buildEmbeddedAppPath("/app/webhook-export", location.search);
  const teamHref = buildEmbeddedAppPath("/app/team", location.search);

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
  const primaryAction = overview.aiOrders > 0
    ? {
        href: optimizationHref,
        label: t(lang, "dashboard_go_to_optimization"),
        description: t(lang, "dashboard_action_opt_description"),
      }
    : {
        href: aiWorkspaceHref,
        label: t(lang, "dashboard_fix_ai_visibility"),
        description: t(lang, "dashboard_action_fix_description"),
      };
  const secondaryAction = overview.aiOrders > 0
    ? {
        href: aiWorkspaceHref,
        label: t(lang, "dashboard_open_ai_workspace"),
      }
    : {
        href: attributionHref,
        label: t(lang, "dashboard_review_attribution_rules"),
      };
  const confidenceSummary = isLowSample
    ? (uiLanguage === "English"
        ? `Low sample: ${overview.aiOrders} AI orders collected so far.`
        : `低样本：当前仅积累 ${overview.aiOrders} 笔 AI 订单。`)
    : overview.aiOrders === 0
      ? (uiLanguage === "English"
          ? "No AI-attributed orders yet. Treat current signals as setup guidance."
          : "当前还没有 AI 归因订单，现阶段更适合作为配置与排查参考。")
      : (uiLanguage === "English"
          ? `${overview.aiOrders} AI orders detected in the selected window.`
          : `当前时间窗口内已识别 ${overview.aiOrders} 笔 AI 订单。`);
  const sourceSummary = dataSource === "live"
    ? (uiLanguage === "English" ? "Shopify live orders" : "Shopify 实时订单")
    : dataSource === "stored"
      ? (uiLanguage === "English" ? "Stored order cache" : "已缓存订单")
      : dataSource === "demo"
        ? (uiLanguage === "English" ? "Demo samples" : "演示样例")
        : (uiLanguage === "English" ? "No data" : "暂无数据");
  const resultSummary = overview.aiOrders > 0
    ? (uiLanguage === "English"
        ? `AI channels contributed ${fmtCurrency(overview.aiGMV)} and ${fmtPercent(overview.aiShare)} of GMV in this window.`
        : `当前窗口内，AI 渠道贡献了 ${fmtCurrency(overview.aiGMV)}，占总 GMV 的 ${fmtPercent(overview.aiShare)}。`)
    : (uiLanguage === "English"
        ? "You can already inspect setup quality and attribution coverage, even before AI-attributed orders appear."
        : "即使还没有 AI 归因订单，你也可以先检查配置质量和归因覆盖情况。");

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
        shopify.toast.show?.(uiLanguage === "English" ? "Upgrade to Pro or Growth to view more history." : "升级到 Pro 或 Growth 版以查看更多历史数据。");
        return;
    }
    const params = getPreservedSearchParams(location.search);
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
        shopify.toast.show?.(uiLanguage === "English" ? "Upgrade to Pro or Growth to use custom ranges." : "升级到 Pro 或 Growth 版以使用自定义时间范围。");
        return;
    }
    if (!customFrom) return;
    const params = getPreservedSearchParams(location.search);
    params.set("range", "custom");
    params.set("from", customFrom);
    params.set("to", customTo || customFrom);
    navigate({ search: `?${params.toString()}` });
  };
  
  // 使用新的 UpgradePrompt 组件替代原有的 UpgradeOverlay

  return (
    <s-page heading={t(lang, "dashboard_page_heading")}>
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
                    {t(lang, "dashboard_free_plan_notice")}
                </span>
                <Link to={billingHref} style={{ color: "#0050b3", fontWeight: "bold", textDecoration: "underline" }}>
                    {uiLanguage === "English" ? "Upgrade plan" : "升级套餐"}
                </Link>
            </div>
        )}
      
        <div className={styles.pageHeader}>
          <div className={styles.titleBlock}>
            <div className={styles.badgeRow}>
              <span className={styles.badge}>{t(lang, "badge_v01")}</span>
              <span className={styles.badgeSecondary}>{t(lang, "badge_conservative_orders")}</span>
              <span className={styles.badgeSecondary}>{dateRange.label}</span>
            </div>
            <h1 className={styles.heading}>{t(lang, "dashboard_title")}</h1>
            <p className={styles.subheading}>{t(lang, "dashboard_subheading")}</p>
            <div className={styles.warning}>
              <strong>{t(lang, "dashboard_focus_label")}</strong>
              {resultSummary}
            </div>
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
              <span className={styles.rangeDivider}>{t(lang, "to_date")}</span>
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
                {t(lang, "apply_custom")}
              </button>
            </div>
          </div>
        </div>

        <div className={styles.heroGrid}>
          <div className={styles.card}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.sectionLabel}>{t(lang, "dashboard_results_label")}</p>
                <h3 className={styles.sectionTitle}>{t(lang, "dashboard_results_title")}</h3>
              </div>
              <span className={styles.smallBadge}>{t(lang, "dashboard_results_badge")}</span>
            </div>
            <div className={styles.summaryGrid}>
              <div className={styles.summaryMetric}>
                <span className={styles.summaryLabel}>{t(lang, "kpi_ai_gmv")}</span>
                <strong className={styles.summaryValue}>{fmtCurrency(overview.aiGMV)}</strong>
              </div>
              <div className={styles.summaryMetric}>
                <span className={styles.summaryLabel}>{t(lang, "dashboard_ai_orders_label")}</span>
                <strong className={styles.summaryValue}>{fmtNumber(overview.aiOrders)}</strong>
              </div>
              <div className={styles.summaryMetric}>
                <span className={styles.summaryLabel}>{t(lang, "dashboard_ai_share_label")}</span>
                <strong className={styles.summaryValue}>{fmtPercent(overview.aiShare)}</strong>
              </div>
            </div>
            <p className={styles.helpText}>{resultSummary}</p>
          </div>

          <div className={styles.card}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.sectionLabel}>{t(lang, "dashboard_trust_label")}</p>
                <h3 className={styles.sectionTitle}>{t(lang, "dashboard_trust_title")}</h3>
              </div>
              <span className={styles.smallBadge}>{isLowSample ? t(lang, "dashboard_low_sample_badge") : t(lang, "dashboard_reference_badge")}</span>
            </div>
            <p className={styles.helpText}>{confidenceSummary}</p>
            <ul className={styles.helpList}>
              <li>{t(lang, "dashboard_data_source_prefix")}{sourceSummary}</li>
              <li>{t(lang, "dashboard_last_synced_prefix")}{timeFormatter.format(new Date(overview.lastSyncedAt))}</li>
              <li>{t(lang, "dashboard_last_updated_prefix")}{dataLastUpdated ? timeFormatter.format(new Date(dataLastUpdated)) : fmtTime()}</li>
              <li>{t(lang, "dashboard_metric_scope_prefix")}{gmvMetric} · {timezone} · {currency}</li>
              {clamped && <li>{tp(lang, "dashboard_window_truncated", { n: MAX_DASHBOARD_ORDERS })}</li>}
              {backfillSuppressed && <li>{t(lang, "dashboard_recent_backfill_reused")}</li>}
            </ul>
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
                  {t(lang, "dashboard_backfill_running")}
                </span>
              )}
              {backfillData && (
                <span className={styles.backfillStatus}>
                  {backfillData.queued
                    ? tp(lang, "dashboard_backfill_triggered", { range: backfillData.range || range })
                    : backfillData.reason === "in-flight"
                      ? t(lang, "dashboard_backfill_running_refresh")
                      : t(lang, "dashboard_backfill_cannot_trigger")}
                </span>
              )}
            </div>
          </div>

          <div className={styles.card}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.sectionLabel}>{t(lang, "dashboard_next_step_label")}</p>
                <h3 className={styles.sectionTitle}>{t(lang, "dashboard_next_step_title")}</h3>
              </div>
              <span className={styles.smallBadge}>{t(lang, "dashboard_action_badge")}</span>
            </div>
            <p className={styles.helpText}>{primaryAction.description}</p>
            <div className={styles.actionButtons}>
              <Link to={primaryAction.href} className={styles.primaryButton}>
                {primaryAction.label}
              </Link>
              <Link to={secondaryAction.href} className={styles.secondaryButton}>
                {secondaryAction.label}
              </Link>
            </div>
            <p className={styles.helpText}>
              {uiLanguage === "English"
                ? t(lang, "dashboard_zero_ai_review_rules")
                : t(lang, "dashboard_zero_ai_review_rules")}
            </p>
          </div>
        </div>

        {dataSource === "demo" && (
          <div className={styles.callout}>
            <span>{t(lang, "hint_title")}</span>
            {t(lang, "dashboard_demo_callout")}
          </div>
        )}
        {dataSource === "empty" && (
          <div className={styles.warning}>
            {t(lang, "dashboard_empty_callout")}
            <Link to={attributionHref} className={styles.link} style={{ marginLeft: 8 }}>
              {t(lang, "dashboard_open_attribution")}
            </Link>
          </div>
        )}
        {overview.aiOrders === 0 && overview.totalOrders > 0 && (
          <div className={styles.callout}>
            <span>{t(lang, "hint_title")}</span>
            {t(lang, "hint_zero_ai")}
            <Link to={attributionHref} className={styles.link}>{t(lang, "dashboard_open_attribution")}</Link>
          </div>
        )}

        <div className={styles.heroGrid}>
          <div className={styles.card}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.sectionLabel}>{t(lang, "metrics_section_label")}</p>
                <h3 className={styles.sectionTitle}>{t(lang, "metrics_section_title")}</h3>
              </div>
              <span className={styles.smallBadge}>{t(lang, "dashboard_reference_badge")}</span>
            </div>
            <ul className={styles.helpList}>
              <li>{uiLanguage === "English" ? `GMV: aggregated by ${gmvMetric} (${gmvMetric === "subtotal_price" ? "excluding tax/shipping" : "including tax/shipping"}).` : `GMV：按设置的 ${gmvMetric} 字段汇总（当前为 ${gmvMetric === "subtotal_price" ? "不含税/运费" : "含税/运费"}）。`}</li>
              <li>{uiLanguage === "English" ? "AI GMV: only orders identified as AI channel." : "AI GMV：仅统计被识别为 AI 渠道的订单 GMV。"}</li>
              <li>{uiLanguage === "English" ? "LTV (if shown): historical accumulated GMV within window, no prediction." : "LTV（如展示）：当前为历史累积 GMV，不含预测。"}</li>
            </ul>
          </div>

          <div className={styles.card}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.sectionLabel}>{t(lang, "dashboard_tools_label")}</p>
                <h3 className={styles.sectionTitle}>{t(lang, "dashboard_tools_title")}</h3>
              </div>
              <span className={styles.smallBadge}>{t(lang, "dashboard_tools_badge")}</span>
            </div>
            <div className={styles.toolGrid}>
              <Link to={attributionHref} className={styles.secondaryButton}>{t(lang, "dashboard_tool_attribution")}</Link>
              <Link to={diagnosticsHref} className={styles.secondaryButton}>{t(lang, "dashboard_tool_diagnostics")}</Link>
              <Link to={exportsHref} className={styles.secondaryButton}>{t(lang, "dashboard_tool_exports")}</Link>
              <Link to={healthHref} className={styles.secondaryButton}>{t(lang, "dashboard_tool_system_health")}</Link>
              <Link to={utmWizardHref} className={styles.secondaryButton}>{t(lang, "dashboard_tool_utm_wizard")}</Link>
              {canUseCopilot ? (
                <Link to={copilotHref} className={styles.secondaryButton}>Copilot</Link>
              ) : (
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => shopify.toast.show?.(uiLanguage === "English" ? "Upgrade to Pro or Growth to unlock Copilot." : "升级到 Pro 或 Growth 版以解锁 Copilot。")}
                >
                  {t(lang, "dashboard_tool_copilot_growth")}
                </button>
              )}
              {canUseGrowthTools ? (
                <>
                  <Link to={multiStoreHref} className={styles.secondaryButton}>{t(lang, "dashboard_tool_multi_store")}</Link>
                  <Link to={teamHref} className={styles.secondaryButton}>{t(lang, "dashboard_tool_team")}</Link>
                  <Link to={webhookExportHref} className={styles.secondaryButton}>{t(lang, "dashboard_tool_webhook_export")}</Link>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => shopify.toast.show?.(uiLanguage === "English" ? "Upgrade to Growth to unlock Multi-Store." : "升级到 Growth 版以解锁多店铺汇总。")}
                  >
                    {t(lang, "dashboard_tool_multi_store_growth")}
                  </button>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => shopify.toast.show?.(uiLanguage === "English" ? "Upgrade to Growth to unlock Team." : "升级到 Growth 版以解锁团队功能。")}
                  >
                    {t(lang, "dashboard_tool_team_growth")}
                  </button>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => shopify.toast.show?.(uiLanguage === "English" ? "Upgrade to Growth to unlock Webhook Export." : "升级到 Growth 版以解锁 Webhook 导出。")}
                  >
                    {t(lang, "dashboard_tool_webhook_export_growth")}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* KPI 卡片组件 */}
        <LlmsTxtPanel
          language={lang}
          shopDomain={shopDomain}
          initialStatus={llmsStatus}
          initialExposurePreferences={exposurePreferences}
          canManage={canManageLlms}
          canUseAdvanced={canUseLlmsAdvanced}
          editable={false}
          compact
          showPreview={false}
          context="dashboard"
          workspaceHref={aiWorkspaceHref}
        />
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
                  {uiLanguage === "English" ? `${overview.aiOrders} AI orders · higher confidence` : `${overview.aiOrders} 笔 AI 订单 · 置信度较高`}
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
            {uiLanguage === "English" ? "If attribution looks off, adjust AI domains and UTM mapping in Attribution & Advanced Settings. All results are conservative estimates." : "若识别结果与预期不符，可在「归因与高级设置」中调整 AI 域名与 UTM 映射；所有结果均为保守估计。"}
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
