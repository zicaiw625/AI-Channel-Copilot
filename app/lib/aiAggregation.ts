import type { OrderRecord, DateRange, AIChannel, ChannelStat, ComparisonRow, TrendPoint, ProductRow } from "./aiData";
import type { MetricKey } from "./metrics";
import { metricOrderValue, sumGMV } from "./metrics";

export type TopCustomerRow = {
  customerId: string;
  ltv: number;
  orders: number;
  ai: boolean;
};

export const buildTopCustomers = (
  ordersInRange: OrderRecord[],
  metric: MetricKey,
  topN = 8,
  acquiredMap?: Record<string, boolean>,
): TopCustomerRow[] => {
  const byCustomer = new Map<string, { ltv: number; orders: number; ai: boolean; firstDate?: Date; firstAIAcquired: boolean }>();

  ordersInRange.forEach((order) => {
    if (!order.customerId) return;
    const prev = byCustomer.get(order.customerId) || { ltv: 0, orders: 0, ai: false, firstDate: undefined, firstAIAcquired: false };
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
    .map(([customerId, v]) => ({ customerId, ltv: v.ltv, orders: v.orders, ai: v.ai, firstAIAcquired: acquiredMap ? Boolean(acquiredMap[customerId]) : v.firstAIAcquired, repeatCount: Math.max(0, v.orders - 1) }))
    .sort((a, b) => b.ltv - a.ltv)
    .slice(0, topN);
};

export const buildOverview = (
  ordersInRange: OrderRecord[],
  metric: MetricKey,
  currency: string,
) => {
  const aiOrders = ordersInRange.filter((order) => Boolean(order.aiSource));
  const aiGMV = sumGMV(aiOrders, metric);
  const totalGMV = sumGMV(ordersInRange, metric);
  const aiNewCustomers = aiOrders.filter((order) => order.isNewCustomer).length;
  const totalNewCustomers = ordersInRange.filter((order) => order.isNewCustomer).length;
  const aiOrdersCount = aiOrders.length;
  const totalOrdersCount = ordersInRange.length;
  return {
    totalGMV,
    netGMV: totalGMV,
    aiGMV,
    netAiGMV: aiGMV,
    aiShare: totalGMV ? aiGMV / totalGMV : 0,
    aiOrders: aiOrdersCount,
    aiOrderShare: totalOrdersCount ? aiOrdersCount / totalOrdersCount : 0,
    totalOrders: totalOrdersCount,
    aiNewCustomers,
    aiNewCustomerRate: aiOrdersCount ? aiNewCustomers / aiOrdersCount : 0,
    totalNewCustomers,
    lastSyncedAt: new Date().toISOString(),
    currency,
  };
};

export const buildChannelBreakdown = (
  ordersInRange: OrderRecord[],
  metric: MetricKey,
): ChannelStat[] => {
  const channels: AIChannel[] = ["ChatGPT", "Perplexity", "Gemini", "Copilot", "Other-AI"];
  const colors: Record<AIChannel, string> = {
    ChatGPT: "#635bff",
    Perplexity: "#00a2ff",
    Gemini: "#4285f4",
    Copilot: "#0078d4",
    "Other-AI": "#6c6f78",
  };
  return channels.map((channel) => {
    const scopedOrders = ordersInRange.filter((order) => order.aiSource === channel);
    return {
      channel,
      gmv: sumGMV(scopedOrders, metric),
      orders: scopedOrders.length,
      newCustomers: scopedOrders.filter((order) => order.isNewCustomer).length,
      color: colors[channel],
    };
  });
};

export const buildComparison = (
  ordersInRange: OrderRecord[],
  metric: MetricKey,
): ComparisonRow[] => {
  const channels: AIChannel[] = ["ChatGPT", "Perplexity", "Gemini", "Copilot", "Other-AI"];
  const scopes: { label: string; filter: (order: OrderRecord) => boolean }[] = [
    { label: "整体", filter: () => true },
    ...channels.map((channel) => ({ label: channel, filter: (order: OrderRecord) => order.aiSource === channel })),
  ];
  return scopes.map(({ label, filter }) => {
    const scopedOrders = ordersInRange.filter(filter);
    const gmv = sumGMV(scopedOrders, metric);
    const ordersCount = scopedOrders.length;
    const customers = scopedOrders.reduce<Record<string, number>>((acc, order) => {
      if (!order.customerId) return acc;
      acc[order.customerId] = (acc[order.customerId] || 0) + 1;
      return acc;
    }, {});
    const repeats = Object.values(customers).filter((count) => count > 1).length;
    return {
      channel: label,
      aov: ordersCount ? gmv / ordersCount : 0,
      newCustomerRate: ordersCount ? scopedOrders.filter((order) => order.isNewCustomer).length / ordersCount : 0,
      repeatRate: Object.keys(customers).length ? repeats / Object.keys(customers).length : 0,
      sampleSize: ordersCount,
      isLowSample: ordersCount < 5,
    };
  });
};

const toZonedDate = (date: Date, timeZone?: string) => {
  if (!timeZone) return new Date(date);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value || 0);
  return new Date(Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")));
};

const startOfDay = (date: Date, timeZone?: string) => {
  const copy = toZonedDate(date, timeZone);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
};

const formatDateOnly = (date: Date, timeZone?: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);

type TrendBucket = "day" | "week" | "month";
const determineBucket = (range: DateRange): TrendBucket => {
  if (range.key === "7d") return "day";
  if (range.key === "30d") return "week";
  if (range.key === "90d") return "month";
  if (range.days <= 14) return "day";
  if (range.days <= 60) return "week";
  return "month";
};

const formatDateLabel = (date: Date, bucket: TrendBucket, timeZone?: string) => {
  if (bucket === "day") return formatDateOnly(date, timeZone);
  if (bucket === "week") {
    const start = startOfDay(date, timeZone);
    const day = start.getUTCDay();
    const diff = (day + 6) % 7;
    start.setUTCDate(start.getUTCDate() - diff);
    return `${formatDateOnly(start, timeZone)} · 周`;
  }
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).format(date);
};

export const buildTrend = (
  ordersInRange: OrderRecord[],
  range: DateRange,
  metric: MetricKey,
  timeZone?: string,
): TrendPoint[] => {
  const bucket = determineBucket(range);
  const buckets = new Map<
    string,
    { label: string; aiGMV: number; aiOrders: number; overallGMV: number; overallOrders: number; byChannel: Partial<Record<AIChannel, { gmv: number; orders: number }>>; sortKey: number }
  >();
  ordersInRange.forEach((order) => {
    const bucketStart = startOfDay(new Date(order.createdAt), timeZone);
    if (bucket === "week") {
      const day = bucketStart.getUTCDay();
      const diff = (day + 6) % 7;
      bucketStart.setUTCDate(bucketStart.getUTCDate() - diff);
    }
    if (bucket === "month") bucketStart.setUTCDate(1);
    const label = formatDateLabel(bucketStart, bucket, timeZone);
    if (!buckets.has(label)) {
      buckets.set(label, { label, aiGMV: 0, aiOrders: 0, overallGMV: 0, overallOrders: 0, byChannel: {}, sortKey: bucketStart.getTime() });
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
  return Array.from(buckets.values()).sort((a, b) => a.sortKey - b.sortKey).map(({ sortKey, ...rest }) => rest);
};

export const buildProducts = (
  ordersInRange: OrderRecord[],
  metric: MetricKey,
): ProductRow[] => {
  const products = new Map<string, { id: string; title: string; handle: string; url: string; aiOrders: number; aiGMV: number; totalOrders: number; byChannel: Partial<Record<AIChannel, number>> }>();
  ordersInRange.forEach((order) => {
    const isAI = Boolean(order.aiSource);
    const orderValue = metricOrderValue(order, metric);
    const lineTotal = order.products.reduce((sum, line) => sum + line.price * line.quantity, 0);
    const allocationDenominator = lineTotal || order.products.length || 1;
    const productSeen = new Set<string>();
    order.products.forEach((line) => {
      if (!products.has(line.id)) {
        products.set(line.id, { id: line.id, title: line.title, handle: line.handle, url: line.url, aiOrders: 0, aiGMV: 0, totalOrders: 0, byChannel: {} });
      }
      const product = products.get(line.id)!;
      if (!productSeen.has(line.id)) {
        product.totalOrders += 1;
        if (isAI) product.aiOrders += 1;
        productSeen.add(line.id);
      }
      if (isAI) {
        const share = lineTotal > 0 ? (line.price * line.quantity) / lineTotal : 1 / allocationDenominator;
        const allocatedGmv = orderValue * share;
        product.aiGMV += allocatedGmv;
        if (order.aiSource) {
          product.byChannel[order.aiSource] = (product.byChannel[order.aiSource] || 0) + allocatedGmv;
        }
      }
    });
  });
  return Array.from(products.values())
    .map((product) => {
      const topChannel = Object.entries(product.byChannel).sort(([, a], [, b]) => b - a)[0]?.[0] ?? null;
      return { id: product.id, title: product.title, handle: product.handle, url: product.url, aiOrders: product.aiOrders, aiGMV: product.aiGMV, aiShare: product.totalOrders ? product.aiOrders / product.totalOrders : 0, topChannel: topChannel as AIChannel | null };
    })
    .sort((a, b) => b.aiGMV - a.aiGMV)
    .slice(0, 8);
};
