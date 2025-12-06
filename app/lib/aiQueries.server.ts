import type {
  ComparisonRow,
  DashboardData,
  DateRange,
  OrderRecord,
  ProductRow,
  SettingsDefaults,
  RawOrderRow,
  OverviewMetrics,
  ChannelStat,
  TrendPoint,
  TopCustomerRow,
  AIChannel,
} from "./aiData";
import { buildDashboardData, buildDashboardFromOrders, AI_CHANNELS } from "./aiData";
import { loadOrdersFromDb, loadCustomersByIdsLegacy as loadCustomersByIds } from "./persistence.server";
import { allowDemoData } from "./runtime.server";
import prisma from "../db.server";
import { Prisma } from "@prisma/client";
import { fromPrismaAiSource } from "./aiSourceMapper";
import { startOfDay, formatDateOnly } from "./dateUtils";
import { logger } from "./logger.server";

type DashboardQueryOptions = {
  timezone?: string;
  allowDemo?: boolean;
  orders?: OrderRecord[];
};

// 辅助函数：计算总值
const getSum = (agg: Prisma.GetOrderAggregateType<any>, metric: string) => {
  const sum = agg._sum as any;
  if (metric === "subtotal_price") return sum.subtotalPrice || 0;
  return sum.totalPrice || 0; // Default to current_total_price which maps to totalPrice in DB schema
};

/**
 * DB 聚合模式：直接从数据库查询统计数据
 */
async function buildDashboardFromDb(
  shopDomain: string,
  range: DateRange,
  settings: SettingsDefaults,
  timezone: string = "UTC"
): Promise<DashboardData> {
  const currency = settings.primaryCurrency || "USD";
  const metric = settings.gmvMetric;

  // 基础过滤条件
  const where: Prisma.OrderWhereInput = {
    shopDomain,
    createdAt: { gte: range.start, lte: range.end },
    currency: currency,
    sourceName: { notIn: ["pos", "draft"] }, // 排除 POS 和 Draft
  };

  // 1. 概览数据聚合
  const [totalAgg, aiAgg] = await Promise.all([
    prisma.order.aggregate({
      where,
      _sum: { totalPrice: true, subtotalPrice: true, refundTotal: true },
      _count: { _all: true },
    }),
    prisma.order.aggregate({
      where: { ...where, aiSource: { not: null } },
      _sum: { totalPrice: true, subtotalPrice: true, refundTotal: true },
      _count: { _all: true },
    }),
  ]);

  const totalGMV = getSum(totalAgg, metric);
  const totalNetGMV = totalGMV - (totalAgg._sum.refundTotal || 0);
  const aiGMV = getSum(aiAgg, metric);
  const aiNetGMV = aiGMV - (aiAgg._sum.refundTotal || 0);

  // 获取新客数（需要 GroupBy 或 Count with filter）
  const [totalNew, aiNew] = await Promise.all([
    prisma.order.count({ where: { ...where, isNewCustomer: true } }),
    prisma.order.count({ where: { ...where, aiSource: { not: null }, isNewCustomer: true } }),
  ]);

  const overview: OverviewMetrics = {
    totalGMV,
    netGMV: totalNetGMV,
    aiGMV,
    netAiGMV: aiNetGMV,
    aiShare: totalGMV ? aiGMV / totalGMV : 0,
    aiOrders: aiAgg._count._all,
    aiOrderShare: totalAgg._count._all ? aiAgg._count._all / totalAgg._count._all : 0,
    totalOrders: totalAgg._count._all,
    aiNewCustomers: aiNew,
    aiNewCustomerRate: aiAgg._count._all ? aiNew / aiAgg._count._all : 0,
    totalNewCustomers: totalNew,
    lastSyncedAt: new Date().toISOString(),
    currency,
  };

  // 2. 渠道细分 (GroupBy AI Source)
  const channelGroups = await prisma.order.groupBy({
    by: ["aiSource", "isNewCustomer"],
    where: { ...where, aiSource: { not: null } },
    _sum: { totalPrice: true, subtotalPrice: true },
    _count: { _all: true },
  });

  const channelMap = new Map<string, ChannelStat>();
  
  // 初始化所有渠道
  AI_CHANNELS.forEach(c => {
    channelMap.set(c, {
      channel: c,
      gmv: 0,
      orders: 0,
      newCustomers: 0,
      color: "", // 可以在前端或 aiData 中补充
    });
  });

  const CHANNEL_COLORS: Record<string, string> = {
    ChatGPT: "#635bff",
    Perplexity: "#00a2ff",
    Gemini: "#4285f4",
    Copilot: "#0078d4",
    "Other-AI": "#6c6f78",
  };

  channelGroups.forEach((group) => {
    if (!group.aiSource) return;
    const channelName = fromPrismaAiSource(group.aiSource);
    if (!channelName || !channelMap.has(channelName)) return;

    const stat = channelMap.get(channelName)!;
    const gmv = metric === "subtotal_price" ? (group._sum.subtotalPrice || 0) : (group._sum.totalPrice || 0);
    
    stat.gmv += gmv;
    stat.orders += group._count._all;
    if (group.isNewCustomer) {
      stat.newCustomers += group._count._all;
    }
    stat.color = CHANNEL_COLORS[channelName] || "#ccc";
  });

  const channels = Array.from(channelMap.values());

  // 3. 趋势数据 (需要轻量级 Fetch)
  // 为了准确按时区 Day/Week 分组，我们在内存中处理，但只取必要字段
  const trendOrders = await prisma.order.findMany({
    where,
    select: { createdAt: true, totalPrice: true, subtotalPrice: true, aiSource: true },
    orderBy: { createdAt: "asc" },
  });

  // 使用 aiAggregation 中的逻辑需要适配
  // 这里我们手写一个简单的 Trend Builder，因为不想依赖 aiAggregation 的 OrderRecord 类型
  const buildTrendLocal = () => {
    // 复用 aiAggregation 的 bucket 逻辑? 
    // 简单实现：
    const bucketMap = new Map<string, TrendPoint & { sortKey: number }>();
    
    // Determine bucket
    let bucket: "day" | "week" | "month" = "day";
    if (range.days > 60) bucket = "month";
    else if (range.days > 14) bucket = "week";

    trendOrders.forEach(o => {
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
         key = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit" }).format(date);
         const start = new Date(date);
         start.setUTCDate(1); 
         sortKey = start.getTime();
       }

       if (!bucketMap.has(key)) {
         bucketMap.set(key, {
           label: key,
           aiGMV: 0, aiOrders: 0, overallGMV: 0, overallOrders: 0,
           byChannel: {},
           sortKey: sortKey
         });
       }
       
       const entry = bucketMap.get(key)!;
       const val = metric === "subtotal_price" ? (o.subtotalPrice || 0) : o.totalPrice;
       
       entry.overallGMV += val;
       entry.overallOrders += 1;
       // 更新 sortKey 为最小值（最早时间）
       entry.sortKey = Math.min(entry.sortKey, sortKey);
       
       if (o.aiSource) {
         const channel = fromPrismaAiSource(o.aiSource);
         if (channel) {
           entry.aiGMV += val;
           entry.aiOrders += 1;
           if (!entry.byChannel![channel]) entry.byChannel![channel] = { gmv: 0, orders: 0 };
           entry.byChannel![channel]!.gmv += val;
           entry.byChannel![channel]!.orders += 1;
         }
       }
    });
    
    // 按时间排序
    return Array.from(bucketMap.values())
      .sort((a, b) => a.sortKey - b.sortKey)
      .map(({ sortKey: _sortKey, ...rest }) => rest);
  };
  
  const trend = buildTrendLocal();

  // 4. Top Products (需要查询 OrderProduct)
  // 为了性能，我们只查询 AI 相关的 OrderProduct 来计算 AI GMV 和 Top Channel
  // 全局 Top Products 可能不需要？仪表盘主要是 AI Top Products。
  // 注意：aiAggregation.buildProducts 返回的是 AI GMV 排序的前 8 名。
  // 所以我们只需要查询 AI 订单的 products。
  
  const aiProductLines = await prisma.orderProduct.findMany({
    where: {
      order: { ...where, aiSource: { not: null } }
    },
    select: {
      orderId: true, // 添加 orderId 用于去重
      productId: true, title: true, handle: true, url: true, price: true, quantity: true,
      order: { select: { aiSource: true, totalPrice: true, subtotalPrice: true, products: { select: { price: true, quantity: true } } } }
    }
  });

  const productMap = new Map<string, ProductRow & { _seenOrders: Set<string> }>();
  
  aiProductLines.forEach(line => {
    const pid = line.productId;
    if (!productMap.has(pid)) {
      productMap.set(pid, {
        id: pid,
        title: line.title,
        handle: line.handle || "",
        url: line.url || "",
        aiOrders: 0,
        aiGMV: 0,
        aiShare: 0, // 稍后计算
        topChannel: null, // 稍后计算
        _seenOrders: new Set(), // 用于去重
      });
    }
    const p = productMap.get(pid)!;
    
    // 计算分配比例 (Allocation)
    // 逻辑复用 aiAggregation: lineTotal / orderTotal
    const order = line.order;
    const lineTotal = line.price * line.quantity;
    const orderTotal = order.products.reduce((sum, l) => sum + l.price * l.quantity, 0);
    const orderVal = metric === "subtotal_price" ? (order.subtotalPrice || 0) : order.totalPrice;
    
    const share = orderTotal > 0 ? lineTotal / orderTotal : 0;
    const allocatedGmv = orderVal * share;
    
    // 使用订单 ID 去重，避免同一订单中同一产品多次计数
    const orderKey = line.orderId;
    if (!p._seenOrders.has(orderKey)) {
      p.aiOrders += 1;
      p._seenOrders.add(orderKey);
    }
    p.aiGMV += allocatedGmv;
    
    // Track channel for topChannel
    const channel = fromPrismaAiSource(order.aiSource);
    if (channel) {
       // @ts-ignore - temporary storage on object
       if (!p._channels) p._channels = {};
       // @ts-ignore
       p._channels[channel] = (p._channels[channel] || 0) + allocatedGmv;
    }
  });

  // 处理 Product Map 结果
  const topProducts = Array.from(productMap.values())
    .map(p => {
      // @ts-ignore
      const channels = p._channels as Record<string, number> || {};
      const topChannel = Object.entries(channels).sort(([,a], [,b]) => b - a)[0]?.[0] as AIChannel | null;
      
      // 注意：aiShare 在这里定义为 aiOrders / totalOrders。
      // 我们目前没有查询该产品的 totalOrders (非 AI)。
      // 如果需要精确的 aiShare，我们需要再查一次所有订单的 products。
      // 为了性能，这里暂时设为 1 (100% AI) 或者省略? 
      // 仪表盘上显示的是 "AI 占比"，如果是针对全站销量，那确实需要 Total。
      // 鉴于性能权衡，我们再发一个聚合查询查 Top Products 的 Total Orders。
      return {
        id: p.id,
        title: p.title,
        handle: p.handle,
        url: p.url,
        aiOrders: p.aiOrders,
        aiGMV: p.aiGMV,
        aiShare: p.aiShare,
        topChannel,
      };
    })
    .sort((a, b) => b.aiGMV - a.aiGMV)
    .slice(0, 8); // Top 8

  // 补充 Total Orders for Top 8
  if (topProducts.length > 0) {
    const topIds = topProducts.map(p => p.id);
    const totalCounts = await prisma.orderProduct.groupBy({
      by: ["productId"],
      where: {
        productId: { in: topIds },
        order: where
      },
      _count: { orderId: true } // 近似订单数
    });
    
    const countMap = new Map(totalCounts.map(c => [c.productId, c._count.orderId]));
    topProducts.forEach(p => {
      const total = countMap.get(p.id) || p.aiOrders;
      p.aiShare = total ? p.aiOrders / total : 0;
    });
  }

  // 5. Comparison (Channel vs Overall)
  // 已经有 channelGroups (AI) 和 overview (Total)。
  // ComparisonRow 需要: aov, newCustomerRate, repeatRate, sampleSize.
  // RepeatRate 需要 GroupBy customerId，这对 DB 压力较大。
  // 简化版 Comparison: 
  const buildComparisonLocal = (): ComparisonRow[] => {
     // Overall
     const overall: ComparisonRow = {
       channel: "整体",
       aov: overview.totalOrders ? overview.totalGMV / overview.totalOrders : 0,
       newCustomerRate: overview.totalOrders ? overview.totalNewCustomers / overview.totalOrders : 0,
       repeatRate: 0, // DB 模式下暂不支持复杂的复购率计算，或者需要额外查询
       sampleSize: overview.totalOrders,
       isLowSample: overview.totalOrders < 5
     };

     const channelRows = AI_CHANNELS.map(c => {
       const stat = channelMap.get(c)!;
       return {
         channel: c,
         aov: stat.orders ? stat.gmv / stat.orders : 0,
         newCustomerRate: stat.orders ? stat.newCustomers / stat.orders : 0,
         repeatRate: 0, // Placeholder
         sampleSize: stat.orders,
         isLowSample: stat.orders < 5
       };
     });

     return [overall, ...channelRows];
  };
  const comparison = buildComparisonLocal();

  // 6. Top Customers (按 LTV)
  const topCustomerAgg = await prisma.order.groupBy({
    by: ["customerId"],
    where: { ...where, customerId: { not: null } },
    _sum: { totalPrice: true, subtotalPrice: true },
    _count: { _all: true },
    orderBy: {
      _sum: {
        totalPrice: "desc" // 默认按总价排序，如果 metric 是 subtotal 也不太好改 orderBy key，Prisma 限制
      }
    },
    take: 8
  });

  // 获取这些客户的 AI 属性
  const topCusIds = topCustomerAgg.map(c => c.customerId!).filter(Boolean);
  const cusDetails = await loadCustomersByIds(shopDomain, topCusIds);
  const cusMap = new Map(cusDetails.map(c => [c.id, c]));

  const topCustomers: TopCustomerRow[] = topCustomerAgg.map(agg => {
    const cid = agg.customerId!;
    const val = metric === "subtotal_price" ? (agg._sum.subtotalPrice || 0) : (agg._sum.totalPrice || 0);
    const cus = cusMap.get(cid);
    
    // 检查此客户在此时间段内是否有 AI 订单？
    // 上面的聚合没有区分 AI。
    // 我们需要知道 `ai` (boolean) 和 `firstAIAcquired`.
    // `cus.acquiredViaAi` 是全局属性。
    // `ai` 属性是指在此时间范围内是否有 AI 订单。
    // 这需要额外查询。鉴于只有 8 个客户，可以接受。
    
    return {
      customerId: cid,
      ltv: val,
      orders: agg._count._all,
      ai: false, // 暂无法高效获取，或者需要对这8个人再查一次
      firstAIAcquired: cus?.acquiredViaAi || false,
      repeatCount: Math.max(0, agg._count._all - 1)
    };
  });
  
  // 修正 topCustomers 的 ai 属性
  if (topCustomers.length > 0) {
     const aiHits = await prisma.order.findMany({
       where: {
         ...where,
         customerId: { in: topCusIds },
         aiSource: { not: null }
       },
       select: { customerId: true },
       distinct: ["customerId"]
     });
     const aiHitSet = new Set(aiHits.map(o => o.customerId));
     topCustomers.forEach(c => {
       if (aiHitSet.has(c.customerId)) c.ai = true;
     });
  }

  // 7. Recent Orders
  const recentOrdersRaw = await prisma.order.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true, name: true, createdAt: true, aiSource: true, 
      totalPrice: true, subtotalPrice: true, currency: true,
      referrer: true, landingPage: true, utmSource: true, utmMedium: true,
      customerId: true, sourceName: true, isNewCustomer: true,
      detection: true, detectionSignals: true
    }
  });

  const recentOrders: RawOrderRow[] = recentOrdersRaw.map(o => ({
     id: o.id,
     name: o.name,
     createdAt: o.createdAt.toISOString(),
     totalPrice: metric === "subtotal_price" ? (o.subtotalPrice || 0) : o.totalPrice,
     currency: o.currency,
     aiSource: fromPrismaAiSource(o.aiSource),
     referrer: o.referrer || "",
     landingPage: o.landingPage || "",
     utmSource: o.utmSource || undefined,
     utmMedium: o.utmMedium || undefined,
     customerId: o.customerId,
     sourceName: o.sourceName || undefined,
     isNewCustomer: o.isNewCustomer,
     detection: o.detection || "",
     signals: Array.isArray(o.detectionSignals) ? (o.detectionSignals as string[]) : [],
  }));

  return {
    overview,
    channels,
    comparison,
    trend,
    topProducts,
    topCustomers,
    recentOrders,
    sampleNote: null, // DB 模式没有截断
    exports: {
      ordersCsv: "", // CSV 导出在 DB 模式下暂不支持，或者需要另行处理
      productsCsv: "",
      customersCsv: ""
    }
  };
}


export const getAiDashboardData = async (
  shopDomain: string,
  range: DateRange,
  settings: SettingsDefaults,
  options: DashboardQueryOptions = {},
): Promise<{ data: DashboardData; orders: OrderRecord[] }> => {
  const useDemo = options.allowDemo ?? allowDemoData();
  
  // 决策：使用 DB 聚合还是内存聚合？
  // 优先使用 DB 聚合，除非强制提供了 orders 数组
  const useDbAggregation = !options.orders && !useDemo && shopDomain;

  if (useDbAggregation) {
    try {
      const data = await buildDashboardFromDb(shopDomain, range, settings, options.timezone);
      return { data, orders: [] }; // DB 模式不返回完整订单列表
    } catch (error) {
      logger.error("DB aggregation failed, falling back to legacy", { error });
      // Fallback to legacy if DB fails (e.g. missing indexes or connection issues)
    }
  }

  // Legacy Logic
  const { orders, clamped } = options.orders
    ? { orders: options.orders, clamped: false }
    : shopDomain
      ? await loadOrdersFromDb(shopDomain, range)
      : { orders: [], clamped: false };

  let acquiredMap: Record<string, boolean> | undefined = undefined;
  if (orders.length) {
    const ids = Array.from(new Set(orders.map((o) => o.customerId).filter(Boolean) as string[]));
    if (ids.length) {
      const customers = await loadCustomersByIds(shopDomain, ids);
      acquiredMap = customers.reduce<Record<string, boolean>>((acc, c) => {
        acc[c.id] = Boolean(c.acquiredViaAi);
        return acc;
      }, {});
    }
  }

  const data = orders.length
    ? buildDashboardFromOrders(
        orders,
        range,
        settings.gmvMetric,
        options.timezone,
        settings.primaryCurrency,
        acquiredMap,
      )
    : useDemo
      ? buildDashboardData(range, settings.gmvMetric, options.timezone, settings.primaryCurrency)
      : buildDashboardFromOrders(
          [],
          range,
          settings.gmvMetric,
          options.timezone,
          settings.primaryCurrency,
          undefined,
        );

  const language = settings.languages && settings.languages[0] ? settings.languages[0] : "中文";
  const clampedNote = language === "English" ? "Data is a truncated sample; consider shortening the time range." : "数据为截断样本，建议缩短时间范围";
  const localizeNote = (note: string | null): string | null => {
    if (!note || language !== "English") return note;
    let out = note;
    out = out.replace("AI 渠道订单量当前较低（<5），所有指标仅供参考。", "AI-channel order volume currently low (<5); metrics for reference only.");
    out = out.replace(/已过滤\s+(\d+)\s+笔非\s+([A-Z]{3})\s+货币的订单，汇总仅包含\s+\2。/g, "Filtered $1 orders not in $2; aggregation only includes $2.");
    out = out.replace(/已排除\s+(\d+)\s+笔\s+POS\/草稿订单（不计入站外 AI 链路分析）。/g, "Excluded $1 POS/draft orders (not counted in offsite AI flow analysis).");
    return out;
  };
  return { data: { ...data, sampleNote: clamped ? clampedNote : localizeNote(data.sampleNote) }, orders };
};

export const getAiOverview = async (
  shopDomain: string,
  range: DateRange,
  settings: SettingsDefaults,
  options?: DashboardQueryOptions,
) => {
  const { data } = await getAiDashboardData(shopDomain, range, settings, options);
  return data.overview;
};

export const getAiChannelComparison = async (
  shopDomain: string,
  range: DateRange,
  settings: SettingsDefaults,
  options?: DashboardQueryOptions,
): Promise<ComparisonRow[]> => {
  const { data } = await getAiDashboardData(shopDomain, range, settings, options);
  return data.comparison;
};

export const getAiTopProducts = async (
  shopDomain: string,
  range: DateRange,
  settings: SettingsDefaults,
  options?: DashboardQueryOptions,
): Promise<ProductRow[]> => {
  const { data } = await getAiDashboardData(shopDomain, range, settings, options);
  return data.topProducts;
};

export const getAiRecentOrders = async (
  shopDomain: string,
  range: DateRange,
  settings: SettingsDefaults,
  options?: DashboardQueryOptions,
): Promise<RawOrderRow[]> => {
  const { data } = await getAiDashboardData(shopDomain, range, settings, options);
  return data.recentOrders;
};
