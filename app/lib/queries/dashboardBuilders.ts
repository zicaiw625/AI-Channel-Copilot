/**
 * Dashboard Data Builders
 * 从 aiQueries.server.ts 提取的 Dashboard 数据构建函数
 */

import prisma from "../../db.server";
import { Prisma } from "@prisma/client";
import type {
  DateRange,
  TrendPoint,
  ProductRow,
  ComparisonRow,
  TopCustomerRow,
  RawOrderRow,
  OrderRecord,
  ChannelStat,
  AIChannel,
} from "../aiData";
import { AI_CHANNELS } from "../aiData";
import { fromPrismaAiSource, toPrismaAiSource } from "../aiSourceMapper";
import { startOfDay, formatDateOnly } from "../dateUtils";
import { loadCustomersByIdsLegacy as loadCustomersByIds } from "../persistence.server";
import { buildOrdersCsv, buildProductsCsv, buildCustomersCsv } from "../export";
import {
  SOURCE_NAME_FILTER,
  CHANNEL_COLORS,
  toNumber,
  computeRepeatRate,
  roundMoney,
} from "./helpers";

// ============================================================================
// Types
// ============================================================================

export type DashboardWhereClause = Prisma.OrderWhereInput;

export interface TrendBuilderOptions {
  range: DateRange;
  timezone: string;
  metric: string;
}

// ============================================================================
// Channel Stats Builder
// ============================================================================

export interface ChannelGroupResult {
  aiSource: string | null;
  isNewCustomer: boolean;
  _sum: { totalPrice: unknown; subtotalPrice: unknown };
  _count: { _all: number };
}

/**
 * 构建渠道统计数据
 */
export function buildChannelStats(
  channelGroups: ChannelGroupResult[],
  metric: string
): ChannelStat[] {
  const channelMap = new Map<string, ChannelStat>();

  // 初始化所有渠道
  AI_CHANNELS.forEach((c) => {
    channelMap.set(c, {
      channel: c,
      gmv: 0,
      orders: 0,
      newCustomers: 0,
      color: CHANNEL_COLORS[c] || "#ccc",
    });
  });

  channelGroups.forEach((group) => {
    if (!group.aiSource) return;
    const channelName = fromPrismaAiSource(group.aiSource as any);
    if (!channelName || !channelMap.has(channelName)) return;

    const stat = channelMap.get(channelName)!;
    const gmv =
      metric === "subtotal_price"
        ? toNumber(group._sum.subtotalPrice)
        : toNumber(group._sum.totalPrice);

    stat.gmv += gmv;
    stat.orders += group._count._all;
    if (group.isNewCustomer) {
      stat.newCustomers += group._count._all;
    }
  });

  return Array.from(channelMap.values());
}

// ============================================================================
// Trend Builder
// ============================================================================

interface TrendOrderItem {
  createdAt: Date;
  totalPrice: unknown;
  subtotalPrice: unknown;
  aiSource: string | null;
}

/**
 * 构建趋势数据
 */
export function buildTrendData(
  trendOrders: TrendOrderItem[],
  options: TrendBuilderOptions
): TrendPoint[] {
  const { range, timezone, metric } = options;
  const bucketMap = new Map<string, TrendPoint & { sortKey: number }>();

  // Determine bucket
  let bucket: "day" | "week" | "month" = "day";
  if (range.days > 60) bucket = "month";
  else if (range.days > 14) bucket = "week";

  trendOrders.forEach((o) => {
    const date = new Date(o.createdAt);
    let key = "";
    let sortKey = 0;

    if (bucket === "day") {
      key = formatDateOnly(date, timezone);
      sortKey = startOfDay(date, timezone).getTime();
    } else if (bucket === "week") {
      const start = startOfDay(date, timezone);
      const day = start.getUTCDay();
      const diff = (day + 6) % 7;
      start.setUTCDate(start.getUTCDate() - diff);
      key = `${formatDateOnly(start, timezone)} · 周`;
      sortKey = start.getTime();
    } else {
      key = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
      }).format(date);
      const start = startOfDay(date, timezone);
      start.setUTCDate(1);
      sortKey = start.getTime();
    }

    if (!bucketMap.has(key)) {
      bucketMap.set(key, {
        label: key,
        aiGMV: 0,
        aiOrders: 0,
        overallGMV: 0,
        overallOrders: 0,
        byChannel: {},
        sortKey: sortKey,
      });
    }

    const entry = bucketMap.get(key)!;
    const val =
      metric === "subtotal_price"
        ? toNumber(o.subtotalPrice)
        : toNumber(o.totalPrice);

    entry.overallGMV += val;
    entry.overallOrders += 1;
    entry.sortKey = Math.min(entry.sortKey, sortKey);

    if (o.aiSource) {
      const channel = fromPrismaAiSource(o.aiSource as any);
      if (channel) {
        entry.aiGMV += val;
        entry.aiOrders += 1;
        if (!entry.byChannel![channel])
          entry.byChannel![channel] = { gmv: 0, orders: 0 };
        entry.byChannel![channel]!.gmv += val;
        entry.byChannel![channel]!.orders += 1;
      }
    }
  });

  // 按时间排序
  return Array.from(bucketMap.values())
    .sort((a, b) => a.sortKey - b.sortKey)
    .map(({ sortKey: _sortKey, ...rest }) => rest);
}

// ============================================================================
// Top Products Builder
// ============================================================================

interface ProductLineItem {
  orderId: string;
  productId: string;
  title: string;
  handle: string | null;
  url: string | null;
  price: unknown;
  quantity: number;
  order: {
    aiSource: string | null;
    totalPrice: unknown;
    subtotalPrice: unknown;
    products: Array<{ price: unknown; quantity: number }>;
  };
}

/**
 * 构建 Top Products 数据
 */
export function buildTopProductsData(
  aiProductLines: ProductLineItem[],
  metric: string
): ProductRow[] {
  type ProductMapEntry = ProductRow & {
    _seenOrders: Set<string>;
    _channels: Record<string, number>;
  };

  const productMap = new Map<string, ProductMapEntry>();

  aiProductLines.forEach((line) => {
    const pid = line.productId;
    if (!productMap.has(pid)) {
      productMap.set(pid, {
        id: pid,
        title: line.title,
        handle: line.handle || "",
        url: line.url || "",
        aiOrders: 0,
        aiGMV: 0,
        aiShare: 0,
        topChannel: null,
        _seenOrders: new Set(),
        _channels: {},
      });
    }
    const p = productMap.get(pid)!;

    // 计算分配比例
    const order = line.order;
    const lineTotal = toNumber(line.price) * line.quantity;
    const orderTotal = order.products.reduce(
      (sum, l) => sum + toNumber(l.price) * l.quantity,
      0
    );
    const orderVal =
      metric === "subtotal_price"
        ? toNumber(order.subtotalPrice)
        : toNumber(order.totalPrice);

    const share = orderTotal > 0 ? lineTotal / orderTotal : 0;
    const allocatedGmv = orderVal * share;

    const orderKey = line.orderId;
    if (!p._seenOrders.has(orderKey)) {
      p.aiOrders += 1;
      p._seenOrders.add(orderKey);
    }
    p.aiGMV += allocatedGmv;

    const channel = fromPrismaAiSource(order.aiSource as any);
    if (channel) {
      p._channels[channel] = (p._channels[channel] || 0) + allocatedGmv;
    }
  });

  // 处理 Product Map 结果
  return Array.from(productMap.values())
    .map((p) => {
      const channels = p._channels;
      const topChannel = (Object.entries(channels).sort(
        ([, a], [, b]) => b - a
      )[0]?.[0] || null) as AIChannel | null;

      return {
        id: p.id,
        title: p.title,
        handle: p.handle,
        url: p.url,
        aiOrders: p.aiOrders,
        aiGMV: roundMoney(p.aiGMV),
        aiShare: p.aiShare,
        topChannel,
      };
    })
    .sort((a, b) => b.aiGMV - a.aiGMV)
    .slice(0, 8);
}

// ============================================================================
// Comparison Builder
// ============================================================================

interface RepeatRateGroup {
  customerId: string | null;
  aiSource: string | null;
  _count: { _all: number };
}

export interface ComparisonBuilderInput {
  channelMap: Map<string, ChannelStat>;
  repeatRateData: RepeatRateGroup[];
  overview: {
    totalOrders: number;
    totalGMV: number;
    totalNewCustomers: number;
  };
}

/**
 * 构建对比数据
 */
export function buildComparisonData(input: ComparisonBuilderInput): ComparisonRow[] {
  const { channelMap, repeatRateData, overview } = input;

  // 计算整体复购率
  const customerOrderCounts = new Map<string, number>();
  const aiCustomerOrderCounts = new Map<string, Map<string, number>>();

  repeatRateData.forEach((row) => {
    if (!row.customerId) return;

    // 整体统计
    const prevTotal = customerOrderCounts.get(row.customerId) || 0;
    customerOrderCounts.set(row.customerId, prevTotal + row._count._all);

    // AI 渠道统计
    if (row.aiSource) {
      const aiSourceKey = row.aiSource;
      if (!aiCustomerOrderCounts.has(aiSourceKey)) {
        aiCustomerOrderCounts.set(aiSourceKey, new Map());
      }
      const channelMapLocal = aiCustomerOrderCounts.get(aiSourceKey)!;
      const prevCount = channelMapLocal.get(row.customerId) || 0;
      channelMapLocal.set(row.customerId, prevCount + row._count._all);
    }
  });

  const overallRepeatRate = computeRepeatRate(customerOrderCounts);

  // Overall
  const overall: ComparisonRow = {
    channel: "整体",
    aov: overview.totalOrders ? overview.totalGMV / overview.totalOrders : 0,
    newCustomerRate: overview.totalOrders
      ? overview.totalNewCustomers / overview.totalOrders
      : 0,
    repeatRate: overallRepeatRate,
    sampleSize: overview.totalOrders,
    isLowSample: overview.totalOrders < 5,
  };

  const channelRows = AI_CHANNELS.map((c) => {
    const stat = channelMap.get(c)!;
    const prismaSource = toPrismaAiSource(c);
    const channelCustomerCounts = prismaSource
      ? aiCustomerOrderCounts.get(prismaSource)
      : undefined;
    const channelRepeatRate = channelCustomerCounts
      ? computeRepeatRate(channelCustomerCounts)
      : 0;

    return {
      channel: c,
      aov: stat.orders ? stat.gmv / stat.orders : 0,
      newCustomerRate: stat.orders ? stat.newCustomers / stat.orders : 0,
      repeatRate: channelRepeatRate,
      sampleSize: stat.orders,
      isLowSample: stat.orders < 5,
    };
  });

  return [overall, ...channelRows];
}

// ============================================================================
// Top Customers Builder
// ============================================================================

interface CustomerAggResult {
  customerId: string | null;
  _sum: { totalPrice: unknown; subtotalPrice: unknown };
  _count: { _all: number };
}

/**
 * 构建 Top Customers 数据
 */
export async function buildTopCustomersData(
  shopDomain: string,
  customerAggRaw: CustomerAggResult[],
  metric: string,
  where: DashboardWhereClause
): Promise<TopCustomerRow[]> {
  // 根据实际 metric 在内存中排序并取 Top 8
  const topCustomerAgg = [...customerAggRaw]
    .sort((a, b) => {
      const aVal =
        metric === "subtotal_price"
          ? toNumber(a._sum.subtotalPrice)
          : toNumber(a._sum.totalPrice);
      const bVal =
        metric === "subtotal_price"
          ? toNumber(b._sum.subtotalPrice)
          : toNumber(b._sum.totalPrice);
      return bVal - aVal;
    })
    .slice(0, 8);

  // 获取这些客户的 AI 属性
  const topCusIds = topCustomerAgg
    .map((c) => c.customerId!)
    .filter(Boolean);
  const cusDetails = await loadCustomersByIds(shopDomain, topCusIds);
  const cusMap = new Map(cusDetails.map((c) => [c.id, c]));

  const topCustomers: TopCustomerRow[] = topCustomerAgg.map((agg) => {
    const cid = agg.customerId!;
    const val =
      metric === "subtotal_price"
        ? toNumber(agg._sum.subtotalPrice)
        : toNumber(agg._sum.totalPrice);
    const cus = cusMap.get(cid);

    return {
      customerId: cid,
      ltv: val,
      orders: agg._count._all,
      ai: false,
      firstAIAcquired: cus?.acquiredViaAi || false,
      repeatCount: Math.max(0, agg._count._all - 1),
    };
  });

  // 修正 topCustomers 的 ai 属性
  if (topCustomers.length > 0) {
    const aiHits = await prisma.order.findMany({
      where: {
        ...where,
        customerId: { in: topCusIds },
        aiSource: { not: null },
      },
      select: { customerId: true },
      distinct: ["customerId"],
    });
    const aiHitSet = new Set(aiHits.map((o) => o.customerId));
    topCustomers.forEach((c) => {
      if (aiHitSet.has(c.customerId)) c.ai = true;
    });
  }

  return topCustomers;
}

// ============================================================================
// Recent Orders Builder
// ============================================================================

interface RecentOrderRaw {
  id: string;
  name: string;
  createdAt: Date;
  aiSource: string | null;
  totalPrice: unknown;
  subtotalPrice: unknown;
  currency: string;
  referrer: string | null;
  landingPage: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  customerId: string | null;
  sourceName: string | null;
  isNewCustomer: boolean;
  detection: string | null;
  detectionSignals: unknown;
}

/**
 * 构建最近订单数据
 */
export function buildRecentOrdersData(
  recentOrdersRaw: RecentOrderRaw[],
  metric: string
): RawOrderRow[] {
  return recentOrdersRaw.map((o) => ({
    id: o.id,
    name: o.name,
    createdAt: o.createdAt.toISOString(),
    totalPrice:
      metric === "subtotal_price"
        ? toNumber(o.subtotalPrice)
        : toNumber(o.totalPrice),
    currency: o.currency,
    aiSource: fromPrismaAiSource(o.aiSource as any),
    referrer: o.referrer || "",
    landingPage: o.landingPage || "",
    utmSource: o.utmSource || undefined,
    utmMedium: o.utmMedium || undefined,
    customerId: o.customerId,
    sourceName: o.sourceName || undefined,
    isNewCustomer: o.isNewCustomer,
    detection: o.detection || "",
    signals: Array.isArray(o.detectionSignals)
      ? (o.detectionSignals as string[])
      : [],
  }));
}

// ============================================================================
// CSV Export Builder
// ============================================================================

interface OrderForCsv {
  id: string;
  name: string;
  createdAt: Date;
  totalPrice: unknown;
  currency: string;
  subtotalPrice: unknown;
  refundTotal: unknown;
  aiSource: string | null;
  detection: string | null;
  detectionSignals: unknown;
  referrer: string | null;
  landingPage: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  sourceName: string | null;
  customerId: string | null;
  isNewCustomer: boolean;
  products: Array<{
    productId: string;
    lineItemId: string;
    title: string;
    handle: string | null;
    url: string | null;
    price: unknown;
    currency: string;
    quantity: number;
  }>;
}

/**
 * 构建 CSV 导出数据
 */
export async function buildCsvExportData(
  shopDomain: string,
  aiOrdersForCsv: OrderForCsv[],
  topProducts: ProductRow[],
  metric: string
): Promise<{
  ordersCsv: string;
  productsCsv: string;
  customersCsv: string;
}> {
  // 转换为 OrderRecord 格式
  const ordersForCsv: OrderRecord[] = aiOrdersForCsv.map((o) => ({
    id: o.id,
    name: o.name,
    createdAt: o.createdAt.toISOString(),
    totalPrice: toNumber(o.totalPrice),
    currency: o.currency,
    subtotalPrice:
      o.subtotalPrice === null ? undefined : toNumber(o.subtotalPrice),
    refundTotal: toNumber(o.refundTotal),
    aiSource: fromPrismaAiSource(o.aiSource as any),
    detection: o.detection || "",
    signals: Array.isArray(o.detectionSignals)
      ? (o.detectionSignals as string[])
      : [],
    referrer: o.referrer || "",
    landingPage: o.landingPage || "",
    utmSource: o.utmSource || undefined,
    utmMedium: o.utmMedium || undefined,
    sourceName: o.sourceName || undefined,
    customerId: o.customerId || null,
    isNewCustomer: o.isNewCustomer,
    tags: [],
    products: o.products.map((p) => ({
      id: p.productId,
      lineItemId: p.lineItemId,
      title: p.title,
      handle: p.handle || "",
      url: p.url || "",
      price: toNumber(p.price),
      currency: p.currency,
      quantity: p.quantity,
    })),
  }));

  // 构建 acquiredViaAi Map
  const csvCustomerIds = Array.from(
    new Set(
      ordersForCsv
        .map((o) => o.customerId)
        .filter(Boolean) as string[]
    )
  );
  let csvAcquiredMap: Record<string, boolean> | undefined = undefined;
  if (csvCustomerIds.length > 0) {
    const csvCustomers = await loadCustomersByIds(shopDomain, csvCustomerIds);
    csvAcquiredMap = csvCustomers.reduce<Record<string, boolean>>((acc, c) => {
      acc[c.id] = Boolean(c.acquiredViaAi);
      return acc;
    }, {});
  }

  const gmvMetric =
    metric === "subtotal_price" ? "subtotal_price" : "current_total_price";
  const ordersCsv = buildOrdersCsv(ordersForCsv, gmvMetric);
  const productsCsv = buildProductsCsv(topProducts);
  const customersCsv = buildCustomersCsv(ordersForCsv, gmvMetric, csvAcquiredMap);

  return { ordersCsv, productsCsv, customersCsv };
}

