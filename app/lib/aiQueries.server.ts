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
import { buildOrdersCsv, buildProductsCsv, buildCustomersCsv } from "./export";
import { allowDemoData } from "./runtime.server";
import prisma from "../db.server";
import { Prisma } from "@prisma/client";
import { fromPrismaAiSource, toPrismaAiSource } from "./aiSourceMapper";
import { startOfDay, formatDateOnly } from "./dateUtils";
import { logger } from "./logger.server";
import { t, type Lang } from "./i18n";

// Import helpers from extracted module
import {
  SOURCE_NAME_FILTER,
  CHANNEL_COLORS,
  toNumber,
  getSum,
  computeRepeatRate,
  type OrderAggregateResult,
} from "./queries/helpers";
import { TREND_DATA_DB_AGGREGATION_THRESHOLD } from "./constants";
import { createQueryTimer } from "./metrics/collector";

type DashboardQueryOptions = {
  timezone?: string;
  allowDemo?: boolean;
  orders?: OrderRecord[];
};

/**
 * 【新增】检测店铺最常用的货币
 * 当设置中的货币与实际订单货币不匹配时，用于回退
 */
async function detectPrimaryCurrency(
  shopDomain: string,
  range: DateRange
): Promise<string | null> {
  const currencyGroups = await prisma.order.groupBy({
    by: ["currency"],
    where: {
      shopDomain,
      createdAt: { gte: range.start, lte: range.end },
      ...SOURCE_NAME_FILTER,
    },
    _count: { _all: true },
    orderBy: { _count: { id: "desc" } },
    take: 1,
  });

  return currencyGroups[0]?.currency ?? null;
}

/**
 * DB 聚合模式：直接从数据库查询统计数据
 */
async function buildDashboardFromDb(
  shopDomain: string,
  range: DateRange,
  settings: SettingsDefaults,
  timezone: string = "UTC"
): Promise<DashboardData> {
  let currency = settings.primaryCurrency || "USD";
  const metric = settings.gmvMetric;

  // 【修复】货币回退机制：如果设置的货币没有订单，尝试使用数据库中最常见的货币
  const testCount = await prisma.order.count({
    where: {
      shopDomain,
      createdAt: { gte: range.start, lte: range.end },
      currency: currency,
      ...SOURCE_NAME_FILTER,
    },
  });

  if (testCount === 0) {
    const detectedCurrency = await detectPrimaryCurrency(shopDomain, range);
    if (detectedCurrency && detectedCurrency !== currency) {
      logger.info("[aiQueries] Currency mismatch, using detected currency", {
        shopDomain,
        settingsCurrency: currency,
        detectedCurrency,
        rangeLabel: range.label,
      });
      currency = detectedCurrency;
    }
  }

  // 基础过滤条件
  // 【修复】使用 SOURCE_NAME_FILTER 允许 NULL 值通过，避免把没有 sourceName 的订单过滤掉
  const where: Prisma.OrderWhereInput = {
    shopDomain,
    createdAt: { gte: range.start, lte: range.end },
    currency: currency,
    ...SOURCE_NAME_FILTER, // 排除 POS 和 Draft，但允许 NULL
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
  // Bug Fix: 使用 Math.max 防止净 GMV 为负数（与内存模式保持一致）
  const totalNetGMV = Math.max(0, totalGMV - toNumber(totalAgg._sum.refundTotal));
  const aiGMV = getSum(aiAgg, metric);
  const aiNetGMV = Math.max(0, aiGMV - toNumber(aiAgg._sum.refundTotal));

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

  channelGroups.forEach((group) => {
    if (!group.aiSource) return;
    const channelName = fromPrismaAiSource(group.aiSource);
    if (!channelName || !channelMap.has(channelName)) return;

    const stat = channelMap.get(channelName)!;
    const gmv = metric === "subtotal_price" ? toNumber(group._sum.subtotalPrice) : toNumber(group._sum.totalPrice);
    
    stat.gmv += gmv;
    stat.orders += group._count._all;
    if (group.isNewCustomer) {
      stat.newCustomers += group._count._all;
    }
    stat.color = CHANNEL_COLORS[channelName] || "#ccc";
  });

  const channels = Array.from(channelMap.values());

  // 3. 趋势数据
  // 性能优化：先检查订单数量，决定使用数据库聚合还是内存聚合
  const orderCount = await prisma.order.count({ where });
  const useDbAggregation = orderCount > TREND_DATA_DB_AGGREGATION_THRESHOLD;

  let trend: TrendPoint[];
  
  if (useDbAggregation) {
    // 🔧 大数据量优化：使用数据库层面聚合
    // 使用 createdAtLocal 字段进行日期分组（已按店铺时区存储）
    logger.info("[aiQueries] Using DB aggregation for trend data", {
      shopDomain,
      orderCount,
      threshold: TREND_DATA_DB_AGGREGATION_THRESHOLD,
    });
    
    // 确定聚合粒度
    let truncUnit: "day" | "week" | "month" = "day";
    if (range.days > 60) truncUnit = "month";
    else if (range.days > 14) truncUnit = "week";

    // 使用原生 SQL 进行日期聚合
    // PostgreSQL date_trunc 函数支持 day, week, month
    type TrendAggRow = {
      period: Date;
      overall_gmv: number | null;
      overall_orders: bigint;
      ai_gmv: number | null;
      ai_orders: bigint;
      ai_source: string | null;
    };

    const priceColumn = metric === "subtotal_price" ? '"subtotalPrice"' : '"totalPrice"';
    
    // 构建动态 WHERE 条件
    const sourceNameCondition = `AND ("sourceName" IS NULL OR "sourceName" NOT IN ('pos', 'draft_order', 'shopify_draft_order'))`;
    
    // 慢查询监控
    const endTrendTimer = createQueryTimer("rawQuery", "Order", {
      query: "trend_aggregation",
      shopDomain,
      metadata: { truncUnit, orderCount },
    });
    
    const rawTrendData = await prisma.$queryRawUnsafe<TrendAggRow[]>(`
      SELECT 
        date_trunc('${truncUnit}', COALESCE("createdAtLocal", "createdAt")) as period,
        SUM(${priceColumn}::numeric) as overall_gmv,
        COUNT(*) as overall_orders,
        SUM(CASE WHEN "aiSource" IS NOT NULL THEN ${priceColumn}::numeric ELSE 0 END) as ai_gmv,
        COUNT(CASE WHEN "aiSource" IS NOT NULL THEN 1 END) as ai_orders,
        "aiSource" as ai_source
      FROM "Order"
      WHERE "shopDomain" = $1
        AND "createdAt" >= $2
        AND "createdAt" <= $3
        AND "currency" = $4
        ${sourceNameCondition}
      GROUP BY period, "aiSource"
      ORDER BY period ASC
    `, shopDomain, range.start, range.end, currency);
    
    endTrendTimer(); // 记录查询时间

    // 转换为 TrendPoint 格式
    const trendMap = new Map<string, TrendPoint & { sortKey: number }>();
    
    for (const row of rawTrendData) {
      const periodDate = new Date(row.period);
      let label: string;
      
      if (truncUnit === "day") {
        label = formatDateOnly(periodDate, timezone);
      } else if (truncUnit === "week") {
        label = `${formatDateOnly(periodDate, timezone)} · 周`;
      } else {
        label = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit" }).format(periodDate);
      }
      
      if (!trendMap.has(label)) {
        trendMap.set(label, {
          label,
          aiGMV: 0,
          aiOrders: 0,
          overallGMV: 0,
          overallOrders: 0,
          byChannel: {},
          sortKey: periodDate.getTime(),
        });
      }
      
      const entry = trendMap.get(label)!;
      // 每个 aiSource 是单独一行，所以要累加
      if (row.ai_source === null) {
        // 这行代表非 AI 订单的聚合
        entry.overallGMV += Number(row.overall_gmv || 0);
        entry.overallOrders += Number(row.overall_orders);
      } else {
        // AI 订单
        const channel = fromPrismaAiSource(row.ai_source as Parameters<typeof fromPrismaAiSource>[0]);
        if (channel) {
          const aiGmv = Number(row.ai_gmv || 0);
          const aiOrders = Number(row.ai_orders);
          entry.aiGMV += aiGmv;
          entry.aiOrders += aiOrders;
          entry.overallGMV += Number(row.overall_gmv || 0);
          entry.overallOrders += Number(row.overall_orders);
          if (!entry.byChannel![channel]) {
            entry.byChannel![channel] = { gmv: 0, orders: 0 };
          }
          entry.byChannel![channel]!.gmv += aiGmv;
          entry.byChannel![channel]!.orders += aiOrders;
        }
      }
    }
    
    trend = Array.from(trendMap.values())
      .sort((a, b) => a.sortKey - b.sortKey)
      .map(({ sortKey: _sortKey, ...rest }) => rest);
      
  } else {
    // 小数据量：继续使用内存聚合（更准确的时区处理）
    const trendOrders = await prisma.order.findMany({
      where,
      select: { createdAt: true, totalPrice: true, subtotalPrice: true, aiSource: true },
      orderBy: { createdAt: "asc" },
    });

    const buildTrendLocal = () => {
      const bucketMap = new Map<string, TrendPoint & { sortKey: number }>();
      
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
           const start = startOfDay(date, timezone);
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
         const val = metric === "subtotal_price" ? toNumber(o.subtotalPrice) : toNumber(o.totalPrice);
         
         entry.overallGMV += val;
         entry.overallOrders += 1;
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
      
      return Array.from(bucketMap.values())
        .sort((a, b) => a.sortKey - b.sortKey)
        .map(({ sortKey: _sortKey, ...rest }) => rest);
    };
    
    trend = buildTrendLocal();
  }

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

  // 定义带有额外跟踪字段的产品类型
  type ProductMapEntry = ProductRow & { 
    _seenOrders: Set<string>;
    _channels: Record<string, number>;
  };
  
  const productMap = new Map<string, ProductMapEntry>();
  
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
        _channels: {}, // 渠道 GMV 跟踪
      });
    }
    const p = productMap.get(pid)!;
    
    // 计算分配比例 (Allocation)
    // 逻辑复用 aiAggregation: lineTotal / orderTotal
    const order = line.order;
    const lineTotal = toNumber(line.price) * line.quantity;
    const orderTotal = order.products.reduce((sum, l) => sum + toNumber(l.price) * l.quantity, 0);
    const orderVal = metric === "subtotal_price" ? toNumber(order.subtotalPrice) : toNumber(order.totalPrice);
    
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
       p._channels[channel] = (p._channels[channel] || 0) + allocatedGmv;
    }
  });

  // 处理 Product Map 结果
  const topProducts = Array.from(productMap.values())
    .map(p => {
      const channels = p._channels;
      const topChannel = Object.entries(channels).sort(([,a], [,b]) => b - a)[0]?.[0] as AIChannel | null;
      
      return {
        id: p.id,
        title: p.title,
        handle: p.handle,
        url: p.url,
        aiOrders: p.aiOrders,
        // Bug Fix: 四舍五入到小数点后 2 位，避免浮点数精度问题
        aiGMV: Math.round(p.aiGMV * 100) / 100,
        aiShare: p.aiShare,
        topChannel,
      };
    })
    .sort((a, b) => b.aiGMV - a.aiGMV)
    .slice(0, 8); // Top 8

  // 补充 Total Orders for Top 8
  // Bug Fix: 使用子查询获取去重的订单数，而不是行数
  if (topProducts.length > 0) {
    const topIds = topProducts.map(p => p.id);
    
    // 获取每个产品的去重订单数
    // 由于 Prisma groupBy 的 _count 不支持 distinct，我们需要分步查询
    const ordersByProduct = await prisma.orderProduct.findMany({
      where: {
        productId: { in: topIds },
        order: where
      },
      select: {
        productId: true,
        orderId: true,
      },
    });
    
    // 在内存中计算每个产品的去重订单数
    const countMap = new Map<string, number>();
    const seenOrders = new Map<string, Set<string>>();
    
    ordersByProduct.forEach(item => {
      if (!seenOrders.has(item.productId)) {
        seenOrders.set(item.productId, new Set());
      }
      seenOrders.get(item.productId)!.add(item.orderId);
    });
    
    seenOrders.forEach((orders, productId) => {
      countMap.set(productId, orders.size);
    });
    
    topProducts.forEach(p => {
      const total = countMap.get(p.id) || p.aiOrders;
      p.aiShare = total ? p.aiOrders / total : 0;
    });
  }

  // 5. Comparison (Channel vs Overall)
  // 已经有 channelGroups (AI) 和 overview (Total)。
  // ComparisonRow 需要: aov, newCustomerRate, repeatRate, sampleSize.
  // RepeatRate 需要 GroupBy customerId，计算有多少客户下了多于1单
  
  // 计算复购率：查询每个客户的订单数
  const repeatRateData = await prisma.order.groupBy({
    by: ["customerId", "aiSource"],
    where: { ...where, customerId: { not: null } },
    _count: { _all: true },
  });
  
  // 计算整体复购率
  const customerOrderCounts = new Map<string, number>();
  const aiCustomerOrderCounts = new Map<string, Map<string, number>>(); // aiSource -> customerId -> count
  
  repeatRateData.forEach(row => {
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
      const channelMap = aiCustomerOrderCounts.get(aiSourceKey)!;
      const prevCount = channelMap.get(row.customerId) || 0;
      channelMap.set(row.customerId, prevCount + row._count._all);
    }
  });
  
  const overallRepeatRate = computeRepeatRate(customerOrderCounts);
  
  const buildComparisonLocal = (): ComparisonRow[] => {
     // Overall
     const overall: ComparisonRow = {
       channel: "整体",
       aov: overview.totalOrders ? overview.totalGMV / overview.totalOrders : 0,
       newCustomerRate: overview.totalOrders ? overview.totalNewCustomers / overview.totalOrders : 0,
       repeatRate: overallRepeatRate,
       sampleSize: overview.totalOrders,
       isLowSample: overview.totalOrders < 5
     };

     const channelRows = AI_CHANNELS.map(c => {
       const stat = channelMap.get(c)!;
       const prismaSource = toPrismaAiSource(c);
       const channelCustomerCounts = prismaSource ? aiCustomerOrderCounts.get(prismaSource) : undefined;
       const channelRepeatRate = channelCustomerCounts ? computeRepeatRate(channelCustomerCounts) : 0;
       
       return {
         channel: c,
         aov: stat.orders ? stat.gmv / stat.orders : 0,
         newCustomerRate: stat.orders ? stat.newCustomers / stat.orders : 0,
         repeatRate: channelRepeatRate,
         sampleSize: stat.orders,
         isLowSample: stat.orders < 5
       };
     });

     return [overall, ...channelRows];
  };
  const comparison = buildComparisonLocal();

  // 6. Top Customers (按 LTV)
  // Bug Fix: Prisma groupBy 的 orderBy 不支持动态 key，所以先查询更多数据再在内存中按实际 metric 排序
  const customerAggRaw = await prisma.order.groupBy({
    by: ["customerId"],
    where: { ...where, customerId: { not: null } },
    _sum: { totalPrice: true, subtotalPrice: true },
    _count: { _all: true },
  });
  
  // 根据实际 metric 在内存中排序并取 Top 8
  const topCustomerAgg = [...customerAggRaw]
    .sort((a, b) => {
      const aVal = metric === "subtotal_price" ? toNumber(a._sum.subtotalPrice) : toNumber(a._sum.totalPrice);
      const bVal = metric === "subtotal_price" ? toNumber(b._sum.subtotalPrice) : toNumber(b._sum.totalPrice);
      return bVal - aVal;
    })
    .slice(0, 8);

  // 获取这些客户的 AI 属性
  const topCusIds = topCustomerAgg.map(c => c.customerId!).filter(Boolean);
  const cusDetails = await loadCustomersByIds(shopDomain, topCusIds);
  const cusMap = new Map(cusDetails.map(c => [c.id, c]));

  const topCustomers: TopCustomerRow[] = topCustomerAgg.map(agg => {
    const cid = agg.customerId!;
    const val = metric === "subtotal_price" ? toNumber(agg._sum.subtotalPrice) : toNumber(agg._sum.totalPrice);
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
     totalPrice: metric === "subtotal_price" ? toNumber(o.subtotalPrice) : toNumber(o.totalPrice),
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

  // 8. CSV 导出数据 - 为 DB 模式提供 CSV 支持
  // 查询 AI 订单用于 CSV 导出（限制数量避免内存问题）
  const aiOrdersForCsv = await prisma.order.findMany({
    where: { ...where, aiSource: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 1000, // 限制导出数量
    include: { products: true },
  });

  // 转换为 OrderRecord 格式以复用 CSV 构建函数
  const ordersForCsv: OrderRecord[] = aiOrdersForCsv.map(o => ({
    id: o.id,
    name: o.name,
    createdAt: o.createdAt.toISOString(),
    totalPrice: toNumber(o.totalPrice),
    currency: o.currency,
    subtotalPrice: o.subtotalPrice === null ? undefined : toNumber(o.subtotalPrice),
    refundTotal: toNumber(o.refundTotal),
    aiSource: fromPrismaAiSource(o.aiSource),
    detection: o.detection || "",
    signals: Array.isArray(o.detectionSignals) ? (o.detectionSignals as string[]) : [],
    referrer: o.referrer || "",
    landingPage: o.landingPage || "",
    utmSource: o.utmSource || undefined,
    utmMedium: o.utmMedium || undefined,
    sourceName: o.sourceName || undefined,
    customerId: o.customerId || null,
    isNewCustomer: o.isNewCustomer,
    tags: [],
    products: o.products.map(p => ({
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
  const csvCustomerIds = Array.from(new Set(ordersForCsv.map(o => o.customerId).filter(Boolean) as string[]));
  let csvAcquiredMap: Record<string, boolean> | undefined = undefined;
  if (csvCustomerIds.length > 0) {
    const csvCustomers = await loadCustomersByIds(shopDomain, csvCustomerIds);
    csvAcquiredMap = csvCustomers.reduce<Record<string, boolean>>((acc, c) => {
      acc[c.id] = Boolean(c.acquiredViaAi);
      return acc;
    }, {});
  }

  const ordersCsv = buildOrdersCsv(ordersForCsv, metric === "subtotal_price" ? "subtotal_price" : "current_total_price");
  const productsCsv = buildProductsCsv(topProducts);
  const customersCsv = buildCustomersCsv(ordersForCsv, metric === "subtotal_price" ? "subtotal_price" : "current_total_price", csvAcquiredMap);

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
      ordersCsv,
      productsCsv,
      customersCsv,
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
      logger.error("[dashboard] DB aggregation failed, falling back to legacy", { shopDomain, rangeKey: range.key }, { error });
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
  const clampedNote = t(language as Lang, "data_truncated_sample");
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
