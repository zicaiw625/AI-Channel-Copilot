/**
 * AI 数据模块
 * 
 * AI 渠道识别说明（保守估计）
 * - 识别基于 referrer 域名与 UTM（utm_source/utm_medium）等显式信号；部分 AI/浏览器可能隐藏来源。
 * - 因此，本模块的识别结果偏下限，可能低估 AI 真实贡献；仪表盘与导出均按保守估计展示。
 * - 优先级：referrer > UTM > 其它（标签/备注），并记录冲突与命中 signals 供调试。
 */

import { DEFAULT_RANGE_KEY } from "./constants";
import { detectAiFromFields as detectAiFromFieldsRef, extractUtm as extractUtmRef } from "./aiAttribution";
import { metricOrderValue } from "./metrics";
import {
  buildTopCustomers,
  buildOverview as aggBuildOverview,
  buildChannelBreakdown as aggBuildChannelBreakdown,
  buildComparison as aggBuildComparison,
  buildTrend as aggBuildTrend,
  buildProducts as aggBuildProducts,
} from "./aiAggregation";
import {
  buildOrdersCsv,
  buildProductsCsv,
  buildCustomersCsv,
} from "./export";
import { mockOrders } from "./mockData";

// 从 aiTypes 重新导出所有类型，保持向后兼容
export type {
  AIChannel,
  TimeRangeKey,
  DateRange,
  OrderLine,
  OrderRecord,
  OverviewMetrics,
  ChannelStat,
  ComparisonRow,
  TrendPoint,
  ProductRow,
  RawOrderRow,
  PipelineStatus,
  TaggingSettings,
  ExposurePreferences,
  SettingsDefaults,
  DashboardData,
  AiDomainRule,
  UtmSourceRule,
  DetectionConfig,
  TopCustomerRow,
} from "./aiTypes";

import type {
  AIChannel,
  TimeRangeKey,
  DateRange,
  OrderRecord,
  ProductRow,
  RawOrderRow,
  AiDomainRule,
  UtmSourceRule,
  SettingsDefaults,
  DashboardData,
  PipelineStatus,
} from "./aiTypes";
import { AI_CHANNELS } from "./aiTypes";

// 从 dateUtils 导入日期工具
import { startOfDay, endOfDay, formatDateOnly, parseDateInput } from "./dateUtils";

// 重新导出 AI_CHANNELS 常量
export { AI_CHANNELS } from "./aiTypes";

export const timeRanges: Record<
  TimeRangeKey,
  { label: string; days: number; isCustom?: boolean }
> = {
  "7d": { label: "最近 7 天", days: 7 },
  "30d": { label: "最近 30 天", days: 30 },
  "90d": { label: "最近 90 天", days: 90 },
  custom: { label: "自定义", days: 30, isCustom: true },
};

export const resolveDateRange = (
  key: TimeRangeKey,
  nowDate = new Date(),
  from?: string | null,
  to?: string | null,
  timeZone?: string,
): DateRange => {
  const baseKey: TimeRangeKey = timeRanges[key] ? key : DEFAULT_RANGE_KEY;
  const wantsCustom = baseKey === "custom" || (from && to);

  if (wantsCustom) {
    const start = parseDateInput(from);
    const end = parseDateInput(to);
    if (start && end) {
      const [rangeStart, rangeEnd] =
        start.getTime() <= end.getTime() ? [start, end] : [end, start];
      const normalizedStart = startOfDay(rangeStart, timeZone);
      const normalizedEnd = endOfDay(rangeEnd, timeZone);
      const days = Math.max(
        1,
        Math.round((normalizedEnd.getTime() - normalizedStart.getTime()) / 86_400_000) + 1,
      );
      return {
        key: "custom",
        label: `${formatDateOnly(normalizedStart, timeZone)} → ${formatDateOnly(normalizedEnd, timeZone)}`,
        start: normalizedStart,
        end: normalizedEnd,
        days,
        fromParam: formatDateOnly(normalizedStart, timeZone),
        toParam: formatDateOnly(normalizedEnd, timeZone),
      };
    }
  }

  const preset = timeRanges[baseKey === "custom" ? DEFAULT_RANGE_KEY : baseKey] || timeRanges[DEFAULT_RANGE_KEY];
  const end = endOfDay(nowDate, timeZone);
  const start = startOfDay(end, timeZone);
  start.setUTCDate(start.getUTCDate() - (preset.days - 1));

  return {
    key: baseKey === "custom" ? DEFAULT_RANGE_KEY : baseKey,
    label: preset.label,
    start,
    end,
    days: preset.days,
    fromParam: formatDateOnly(start, timeZone),
    toParam: formatDateOnly(end, timeZone),
  };
};

const defaultAiDomains: AiDomainRule[] = [
  { domain: "chat.openai.com", channel: "ChatGPT", source: "default" },
  { domain: "chatgpt.com", channel: "ChatGPT", source: "default" },
  { domain: "perplexity.ai", channel: "Perplexity", source: "default" },
  { domain: "www.perplexity.ai", channel: "Perplexity", source: "default" },
  { domain: "gemini.google.com", channel: "Gemini", source: "default" },
  { domain: "copilot.microsoft.com", channel: "Copilot", source: "default" },
  { domain: "www.copilot.microsoft.com", channel: "Copilot", source: "default" },
  { domain: "claude.ai", channel: "Other-AI", source: "default" },
  { domain: "deepseek.com", channel: "Other-AI", source: "default" },
];

const defaultUtmSources: UtmSourceRule[] = [
  { value: "chatgpt", channel: "ChatGPT" },
  { value: "perplexity", channel: "Perplexity" },
  { value: "gemini", channel: "Gemini" },
  { value: "copilot", channel: "Copilot" },
  { value: "deepseek", channel: "Other-AI" },
  { value: "claude", channel: "Other-AI" },
];

const defaultUtmMediums = [
  "ai-agent",
  "ai-assistant",
  "assistant",
  "ai-search",
  "ai-chat",
  "ai-referral",
];

const defaultPipelineStatuses: PipelineStatus[] = [
  {
    title: "orders/create webhook",
    status: "healthy",
    detail: "Delivered 12 minutes ago · auto-retries enabled",
  },
  {
    title: "Hourly backfill (last 90 days)",
    status: "info",
    detail: "Catching up 90d orders to avoid webhook gaps",
  },
  {
    title: "AI tagging write-back",
    status: "healthy",
    detail: "Order + customer tags ready · off by default",
  },
];

export const defaultSettings: SettingsDefaults = {
  aiDomains: defaultAiDomains,
  utmSources: defaultUtmSources,
  utmMediumKeywords: defaultUtmMediums,
  gmvMetric: "current_total_price",
  primaryCurrency: "USD",
  tagging: {
    orderTagPrefix: "AI-Source",
    customerTag: "AI-Customer",
    writeOrderTags: false,
    writeCustomerTags: false,
    dryRun: true,
  },
  exposurePreferences: {
    exposeProducts: false,
    exposeCollections: false,
    exposeBlogs: false,
  },
  retentionMonths: 6,
  languages: ["中文", "English"],
  timezones: ["UTC", "America/Los_Angeles", "Asia/Shanghai", "Europe/London"],
  pipelineStatuses: defaultPipelineStatuses,
};

export type DetectionConfig = {
  aiDomains: AiDomainRule[];
  utmSources: UtmSourceRule[];
  utmMediumKeywords: string[];
  tagPrefix?: string;
};

export const LOW_SAMPLE_THRESHOLD = 5;

// Re-export mockOrders to keep compatibility if needed, though better to import from mockData
export { mockOrders };

/** @deprecated 使用 AI_CHANNELS 代替 */
export const channelList: AIChannel[] = [...AI_CHANNELS];

const partitionOrdersByCurrency = (
  records: OrderRecord[],
  primaryCurrency?: string,
): {
  primaryCurrency: string;
  primaryOrders: OrderRecord[];
  foreignOrders: OrderRecord[];
  foreignCurrencies: string[];
} => {
  const preferred = primaryCurrency || records[0]?.currency || "USD";
  const primaryOrders = records.filter((order) => order.currency === preferred);
  const foreignOrders = records.filter((order) => order.currency !== preferred);
  const foreignCurrencies = Array.from(
    new Set(foreignOrders.map((order) => order.currency).filter(Boolean)),
  );

  return { primaryCurrency: preferred, primaryOrders, foreignOrders, foreignCurrencies };
};

const filterOrdersByDateRange = (allOrders: OrderRecord[], range: DateRange) =>
  allOrders.filter((order) => {
    const orderDate = new Date(order.createdAt);
    return orderDate >= range.start && orderDate <= range.end;
  });

const buildRecentOrders = (
  ordersInRange: OrderRecord[],
  metric: "current_total_price" | "subtotal_price" = "current_total_price",
): RawOrderRow[] =>
  [...ordersInRange]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 10)
    .map((order) => ({
      id: order.id,
      name: order.name,
      createdAt: order.createdAt,
      aiSource: order.aiSource,
      totalPrice: metricOrderValue(order, metric),
      currency: order.currency,
      referrer: order.referrer,
      landingPage: order.landingPage,
      utmSource: order.utmSource,
      utmMedium: order.utmMedium,
      customerId: order.customerId,
      sourceName: order.sourceName,
      isNewCustomer: order.isNewCustomer,
      detection: order.detection,
      signals: order.signals,
    }));

const buildSampleNote = (
  overview: OverviewMetrics,
  foreignCurrencies: string[],
  excludedCount: number,
) => {
  const notes = [] as string[];
  if (overview.aiOrders < LOW_SAMPLE_THRESHOLD) {
    notes.push("AI 渠道订单量当前较低（<5），所有指标仅供参考。");
  }

  if (foreignCurrencies.length) {
    notes.push(
      `已过滤 ${excludedCount} 笔非 ${overview.currency} 货币的订单，汇总仅包含 ${overview.currency}。`,
    );
  }

  return notes.length ? notes.join(" ") : null;
};

export const buildDashboardFromOrders = (
  allOrders: OrderRecord[],
  range: DateRange,
  gmvMetric: "current_total_price" | "subtotal_price" = "current_total_price",
  timeZone?: string,
  primaryCurrency?: string,
  acquiredViaAiMap?: Record<string, boolean>,
): DashboardData => {
  const ordersInRange = filterOrdersByDateRange(allOrders, range);
  const excludedBySource = ordersInRange.filter((o) => {
    const src = (o.sourceName || "").toLowerCase();
    return src === "pos" || src === "draft";
  }).length;
  const usableOrders = ordersInRange.filter((o) => {
    const src = (o.sourceName || "").toLowerCase();
    return src !== "pos" && src !== "draft";
  });
  const { primaryCurrency: resolvedCurrency, primaryOrders, foreignOrders, foreignCurrencies } =
    partitionOrdersByCurrency(usableOrders, primaryCurrency);
  const overview = aggBuildOverview(primaryOrders, gmvMetric, resolvedCurrency);
  const channels = aggBuildChannelBreakdown(primaryOrders, gmvMetric);
  const comparison = aggBuildComparison(primaryOrders, gmvMetric);
  const trend = aggBuildTrend(primaryOrders, range, gmvMetric, timeZone);
  const topProducts = aggBuildProducts(primaryOrders, gmvMetric);
  const topCustomers = buildTopCustomers(primaryOrders, gmvMetric, undefined, acquiredViaAiMap);
  const recentOrders = buildRecentOrders(primaryOrders, gmvMetric);
  const ordersCsv = buildOrdersCsv(primaryOrders, gmvMetric);
  const productsCsv = buildProductsCsv(topProducts);
  const customersCsv = buildCustomersCsv(primaryOrders, gmvMetric, acquiredViaAiMap);
  const baseNote = buildSampleNote(overview, foreignCurrencies, foreignOrders.length);
  const posNote = excludedBySource
    ? `已排除 ${excludedBySource} 笔 POS/草稿订单（不计入站外 AI 链路分析）。`
    : null;
  const sampleNote = [baseNote, posNote].filter(Boolean).join(" ") || null;

  return {
    overview,
    channels,
    comparison,
    trend,
    topProducts,
    topCustomers,
    recentOrders,
    sampleNote,
    exports: {
      ordersCsv,
      productsCsv,
      customersCsv,
    },
  };
};

export const buildDashboardData = (
  range: DateRange,
  gmvMetric: "current_total_price" | "subtotal_price" = "current_total_price",
  timeZone?: string,
  primaryCurrency?: string,
): DashboardData => {
  return buildDashboardFromOrders(mockOrders, range, gmvMetric, timeZone, primaryCurrency);
};

type ShopifyMoneySet = {
  shopMoney?: {
    amount?: string | null;
    currencyCode?: string | null;
  } | null;
};

export type ShopifyOrderNode = {
  id: string;
  name: string;
  createdAt: string;
  currentTotalPriceSet?: ShopifyMoneySet | null;
  currentSubtotalPriceSet?: ShopifyMoneySet | null;
  totalRefundedSet?: ShopifyMoneySet | null;
  referringSite?: string | null;
  landingPageUrl?: string | null;
  sourceName?: string | null;
  tags: string[];
  noteAttributes?: { name: string; value: string }[] | null;
  customer?: {
    id: string;
    numberOfOrders?: number | null;
  } | null;
  lineItems: {
    edges: {
      node: {
        id: string;
        quantity: number;
        name: string;
        originalUnitPriceSet?: ShopifyMoneySet | null;
        variant?: {
          product?: {
            id: string;
            title: string;
            handle?: string | null;
            onlineStoreUrl?: string | null;
            legacyResourceId?: string | null;
          } | null;
        } | null;
      };
    }[];
  };
};

export const mapShopifyOrderToRecord = (
  order: ShopifyOrderNode,
  config: SettingsDefaults = defaultSettings,
): OrderRecord => {
  const totalPrice = parseFloat(order.currentTotalPriceSet?.shopMoney?.amount || "0");
  const subtotalRaw = order.currentSubtotalPriceSet?.shopMoney?.amount;
  const subtotalPrice =
    subtotalRaw === undefined || subtotalRaw === null ? undefined : parseFloat(subtotalRaw);
  const refundTotal = parseFloat(order.totalRefundedSet?.shopMoney?.amount || "0");
  const currency =
    order.currentTotalPriceSet?.shopMoney?.currencyCode || config.primaryCurrency || "USD";
  const referrer = order.referringSite || "";
  const landingPage = order.landingPageUrl || "";
  const { utmSource, utmMedium } = extractUtmRef(referrer, landingPage);

  const { aiSource, detection, signals } = detectAiFromFieldsRef(
    referrer,
    landingPage,
    utmSource,
    utmMedium,
    order.tags,
    order.noteAttributes || undefined,
    {
      aiDomains: config.aiDomains,
      utmSources: config.utmSources,
      utmMediumKeywords: config.utmMediumKeywords,
      tagPrefix: config.tagging.orderTagPrefix,
      lang: ((config.languages && config.languages[0]) === "English") ? "English" : "中文",
    },
  );
  const truncatedDetection = detection.slice(0, 200);

  const products: OrderRecord["products"] =
    order.lineItems?.edges?.map(({ node }) => {
      const product = node.variant?.product;
      const handle = product?.handle || "";
      const url = product?.onlineStoreUrl || "";

      return {
        id: product?.id || product?.legacyResourceId?.toString() || node.id,
        title: product?.title || node.name,
        handle,
        url,
        price: parseFloat(node.originalUnitPriceSet?.shopMoney?.amount || "0"),
        currency: node.originalUnitPriceSet?.shopMoney?.currencyCode || currency,
        quantity: node.quantity,
      };
    }) || [];

  const isNewCustomer =
    !order.customer || typeof order.customer.numberOfOrders !== "number"
      ? true
      : order.customer.numberOfOrders <= 1;

  return {
    id: order.id,
    name: order.name,
    createdAt: order.createdAt,
    totalPrice,
    currency,
    subtotalPrice,
    refundTotal,
    aiSource,
    referrer,
    landingPage,
    utmSource,
    utmMedium,
    sourceName: order.sourceName || undefined,
    tags: order.tags || [],
    customerId: order.customer?.id ?? null,
    isNewCustomer,
    products,
    detection: truncatedDetection,
    signals,
  };
};
