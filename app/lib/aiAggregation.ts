/**
 * AI 数据聚合模块
 * 负责构建仪表盘所需的各类统计数据
 */

import type {
  OrderRecord,
  DateRange,
  AIChannel,
  ChannelStat,
  ComparisonRow,
  TrendPoint,
  ProductRow,
  TopCustomerRow,
} from "./aiTypes";
import { AI_CHANNELS } from "./aiTypes";
import type { MetricKey } from "./metrics";
import { metricOrderValue } from "./metrics";
import { startOfDay, formatDateOnly, getWeekStart, getMonthStart } from "./dateUtils";

// 重新导出 TopCustomerRow 以保持向后兼容
export type { TopCustomerRow } from "./aiTypes";

type ChannelAccumulator = {
  gmv: number;
  netGmv: number;
  orders: number;
  newCustomers: number;
  customers: Map<string, number>;
};

type AggregationResult = {
  overall: ChannelAccumulator;
  ai: ChannelAccumulator;
  channels: Record<AIChannel, ChannelAccumulator>;
};

const createAccumulator = (): ChannelAccumulator => ({
  gmv: 0,
  netGmv: 0,
  orders: 0,
  newCustomers: 0,
  customers: new Map(),
});

const updateAccumulator = (
  accumulator: ChannelAccumulator,
  order: OrderRecord,
  orderValue: number,
  netOrderValue: number,
) => {
  accumulator.orders += 1;
  accumulator.gmv += orderValue;
  accumulator.netGmv += netOrderValue;
  if (order.isNewCustomer) accumulator.newCustomers += 1;
  if (order.customerId) {
    const prev = accumulator.customers.get(order.customerId) || 0;
    accumulator.customers.set(order.customerId, prev + 1);
  }
};

const aggregateOrders = (orders: OrderRecord[], metric: MetricKey): AggregationResult => {
  const overall = createAccumulator();
  const ai = createAccumulator();
  const channels = AI_CHANNELS.reduce<Record<AIChannel, ChannelAccumulator>>((acc, channel) => {
    acc[channel] = createAccumulator();
    return acc;
  }, {} as Record<AIChannel, ChannelAccumulator>);

  orders.forEach((order) => {
    const orderValue = metricOrderValue(order, metric);
    const netOrderValue = Math.max(0, orderValue - (order.refundTotal || 0));

    updateAccumulator(overall, order, orderValue, netOrderValue);

    if (order.aiSource) {
      updateAccumulator(ai, order, orderValue, netOrderValue);
      updateAccumulator(channels[order.aiSource], order, orderValue, netOrderValue);
    }
  });

  return { overall, ai, channels };
};

const computeRepeatRate = (customers: Map<string, number>) => {
  if (!customers.size) return 0;
  const repeats = Array.from(customers.values()).filter((count) => count > 1).length;
  return repeats / customers.size;
};

/**
 * 构建顶级客户列表
 */
export const buildTopCustomers = (
  ordersInRange: OrderRecord[],
  metric: MetricKey,
  topN = 8,
  acquiredMap?: Record<string, boolean>
): TopCustomerRow[] => {
  const byCustomer = new Map<
    string,
    { ltv: number; orders: number; ai: boolean; firstDate?: Date; firstAIAcquired: boolean }
  >();

  ordersInRange.forEach((order) => {
    if (!order.customerId) return;
    const prev = byCustomer.get(order.customerId) || {
      ltv: 0,
      orders: 0,
      ai: false,
      firstDate: undefined,
      firstAIAcquired: false,
    };
    prev.ltv += metricOrderValue(order, metric);
    prev.orders += 1;
    prev.ai = prev.ai || Boolean(order.aiSource);
    const createdAt = new Date(order.createdAt);
    if (!prev.firstDate || createdAt < prev.firstDate) {
      prev.firstDate = createdAt;
      prev.firstAIAcquired = Boolean(order.isNewCustomer && order.aiSource);
    }
    byCustomer.set(order.customerId, prev);
  });

  return Array.from(byCustomer.entries())
    .map(([customerId, v]) => ({
      customerId,
      ltv: v.ltv,
      orders: v.orders,
      ai: v.ai,
      firstAIAcquired: acquiredMap ? Boolean(acquiredMap[customerId]) : v.firstAIAcquired,
      repeatCount: Math.max(0, v.orders - 1),
    }))
    .sort((a, b) => b.ltv - a.ltv)
    .slice(0, topN);
};

/**
 * 构建概览指标
 */
export const buildOverview = (
  ordersInRange: OrderRecord[],
  metric: MetricKey,
  currency: string
) => {
  const { overall, ai } = aggregateOrders(ordersInRange, metric);
  const aiOrdersCount = ai.orders;
  const totalOrdersCount = overall.orders;

  // 计算可检测覆盖率：有 referrer 或 UTM 信息的订单比例
  let detectableOrders = 0;
  let ordersWithUtm = 0;
  let ordersWithReferrer = 0;
  
  ordersInRange.forEach((order) => {
    const hasReferrer = Boolean(order.referrer && order.referrer !== "—" && order.referrer !== "");
    const hasUtm = Boolean(order.utmSource || order.utmMedium);
    
    if (hasReferrer) ordersWithReferrer++;
    if (hasUtm) ordersWithUtm++;
    if (hasReferrer || hasUtm) detectableOrders++;
  });

  const detectionCoverage = totalOrdersCount > 0 ? detectableOrders / totalOrdersCount : 0;
  const utmCoverage = totalOrdersCount > 0 ? ordersWithUtm / totalOrdersCount : 0;
  const referrerCoverage = totalOrdersCount > 0 ? ordersWithReferrer / totalOrdersCount : 0;

  return {
    totalGMV: overall.gmv,
    netGMV: overall.netGmv,
    aiGMV: ai.gmv,
    netAiGMV: ai.netGmv,
    aiShare: overall.gmv ? ai.gmv / overall.gmv : 0,
    aiOrders: aiOrdersCount,
    aiOrderShare: totalOrdersCount ? aiOrdersCount / totalOrdersCount : 0,
    totalOrders: totalOrdersCount,
    aiNewCustomers: ai.newCustomers,
    aiNewCustomerRate: aiOrdersCount ? ai.newCustomers / aiOrdersCount : 0,
    totalNewCustomers: overall.newCustomers,
    lastSyncedAt: new Date().toISOString(),
    currency,
    // 新增：可检测覆盖率指标
    detectionCoverage,
    utmCoverage,
    referrerCoverage,
    detectableOrders,
    ordersWithUtm,
    ordersWithReferrer,
  };
};

/** AI 渠道颜色配置 */
const CHANNEL_COLORS: Record<AIChannel, string> = {
  ChatGPT: "#635bff",
  Perplexity: "#00a2ff",
  Gemini: "#4285f4",
  Copilot: "#0078d4",
  "Other-AI": "#6c6f78",
};

/**
 * 构建渠道分解统计
 */
export const buildChannelBreakdown = (
  ordersInRange: OrderRecord[],
  metric: MetricKey
): ChannelStat[] => {
  const { channels } = aggregateOrders(ordersInRange, metric);
  return AI_CHANNELS.map((channel) => ({
    channel,
    gmv: channels[channel].gmv,
    orders: channels[channel].orders,
    newCustomers: channels[channel].newCustomers,
    color: CHANNEL_COLORS[channel],
  }));
};

/**
 * 构建渠道对比数据
 */
export const buildComparison = (
  ordersInRange: OrderRecord[],
  metric: MetricKey
): ComparisonRow[] => {
  const { overall, channels } = aggregateOrders(ordersInRange, metric);

  const scopes: { label: string; data: ChannelAccumulator }[] = [
    { label: "整体", data: overall },
    ...AI_CHANNELS.map((channel) => ({
      label: channel,
      data: channels[channel],
    })),
  ];

  return scopes.map(({ label, data }) => ({
    channel: label,
    aov: data.orders ? data.gmv / data.orders : 0,
    newCustomerRate: data.orders ? data.newCustomers / data.orders : 0,
    repeatRate: computeRepeatRate(data.customers),
    sampleSize: data.orders,
    isLowSample: data.orders < 5,
  }));
};

/** 趋势桶类型 */
type TrendBucket = "day" | "week" | "month";

/** 根据日期范围确定趋势桶粒度 */
const determineBucket = (range: DateRange): TrendBucket => {
  if (range.key === "7d") return "day";
  if (range.key === "30d") return "week";
  if (range.key === "90d") return "month";
  if (range.days <= 14) return "day";
  if (range.days <= 60) return "week";
  return "month";
};

/** 格式化趋势标签 */
const formatTrendLabel = (date: Date, bucket: TrendBucket, timeZone?: string): string => {
  if (bucket === "day") return formatDateOnly(date, timeZone);
  if (bucket === "week") {
    const start = getWeekStart(date, timeZone);
    return `${formatDateOnly(start, timeZone)} · 周`;
  }
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).format(
    date
  );
};

/**
 * 构建趋势数据
 */
export const buildTrend = (
  ordersInRange: OrderRecord[],
  range: DateRange,
  metric: MetricKey,
  timeZone?: string
): TrendPoint[] => {
  const bucket = determineBucket(range);
  const buckets = new Map<
    string,
    {
      label: string;
      aiGMV: number;
      aiOrders: number;
      overallGMV: number;
      overallOrders: number;
      byChannel: Partial<Record<AIChannel, { gmv: number; orders: number }>>;
      sortKey: number;
    }
  >();

  ordersInRange.forEach((order) => {
    const orderDate = new Date(order.createdAt);
    let bucketStart: Date;
    if (bucket === "week") {
      bucketStart = getWeekStart(orderDate, timeZone);
    } else if (bucket === "month") {
      bucketStart = getMonthStart(orderDate, timeZone);
    } else {
      bucketStart = startOfDay(orderDate, timeZone);
    }

    const label = formatTrendLabel(bucketStart, bucket, timeZone);
    if (!buckets.has(label)) {
      buckets.set(label, {
        label,
        aiGMV: 0,
        aiOrders: 0,
        overallGMV: 0,
        overallOrders: 0,
        byChannel: {},
        sortKey: bucketStart.getTime(),
      });
    }

    const bucketValue = buckets.get(label)!;
    const orderValue = metricOrderValue(order, metric);
    bucketValue.overallGMV += orderValue;
    bucketValue.overallOrders += 1;
    bucketValue.sortKey = Math.min(bucketValue.sortKey, bucketStart.getTime());

    if (order.aiSource) {
      bucketValue.aiGMV += orderValue;
      bucketValue.aiOrders += 1;
      const channelMetrics = bucketValue.byChannel[order.aiSource] || { gmv: 0, orders: 0 };
      channelMetrics.gmv += orderValue;
      channelMetrics.orders += 1;
      bucketValue.byChannel[order.aiSource] = channelMetrics;
    }
  });

  return Array.from(buckets.values())
    .sort((a, b) => a.sortKey - b.sortKey)
    .map(({ label, aiGMV, aiOrders, overallGMV, overallOrders, byChannel }) => ({
      label,
      aiGMV,
      aiOrders,
      overallGMV,
      overallOrders,
      byChannel,
    }));
};

/**
 * 构建产品统计数据
 */
export const buildProducts = (ordersInRange: OrderRecord[], metric: MetricKey): ProductRow[] => {
  const products = new Map<
    string,
    {
      id: string;
      title: string;
      handle: string;
      url: string;
      aiOrders: number;
      aiGMV: number;
      totalOrders: number;
      byChannel: Partial<Record<AIChannel, number>>;
    }
  >();

  ordersInRange.forEach((order) => {
    const isAI = Boolean(order.aiSource);
    const orderValue = metricOrderValue(order, metric);
    const lineTotal = order.products.reduce((sum, line) => sum + line.price * line.quantity, 0);
    const allocationDenominator = lineTotal || order.products.length || 1;
    const productSeen = new Set<string>();

    order.products.forEach((line) => {
      if (!products.has(line.id)) {
        products.set(line.id, {
          id: line.id,
          title: line.title,
          handle: line.handle,
          url: line.url,
          aiOrders: 0,
          aiGMV: 0,
          totalOrders: 0,
          byChannel: {},
        });
      }
      const product = products.get(line.id)!;
      if (!productSeen.has(line.id)) {
        product.totalOrders += 1;
        if (isAI) product.aiOrders += 1;
        productSeen.add(line.id);
      }
      if (isAI) {
        const share =
          lineTotal > 0 ? (line.price * line.quantity) / lineTotal : 1 / allocationDenominator;
        const allocatedGmv = orderValue * share;
        product.aiGMV += allocatedGmv;
        if (order.aiSource) {
          product.byChannel[order.aiSource] =
            (product.byChannel[order.aiSource] || 0) + allocatedGmv;
        }
      }
    });
  });

  return Array.from(products.values())
    .map((product) => {
      const topChannel =
        (Object.entries(product.byChannel).sort(([, a], [, b]) => b - a)[0]?.[0] as AIChannel) ??
        null;
      return {
        id: product.id,
        title: product.title,
        handle: product.handle,
        url: product.url,
        aiOrders: product.aiOrders,
        // Bug Fix: 四舍五入到小数点后 2 位，避免浮点数精度问题
        aiGMV: Math.round(product.aiGMV * 100) / 100,
        aiShare: product.totalOrders ? product.aiOrders / product.totalOrders : 0,
        topChannel,
      };
    })
    .sort((a, b) => b.aiGMV - a.aiGMV)
    .slice(0, 8);
};
