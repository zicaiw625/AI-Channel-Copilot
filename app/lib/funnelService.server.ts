/**
 * 漏斗归因服务
 * 支持更细粒度的漏斗分析：访问 → 加购 → 结账 → 成交
 */

import prisma from "../db.server";
import { resolveDateRange, type TimeRangeKey, type AIChannel, type AiDomainRule, type UtmSourceRule } from "./aiData";
import { toPrismaAiSource, fromPrismaAiSource } from "./aiSourceMapper";
import { detectAiFromFields } from "./aiAttribution";
import { logger } from "./logger.server";
import type { AiSource } from "@prisma/client";

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 安全解析浮点数，处理各种无效输入
 * @param value - 要解析的字符串
 * @param fallback - 解析失败时的默认值
 */
function safeParseFloat(value: string | undefined | null, fallback = 0): number {
  if (!value || typeof value !== "string") return fallback;
  // 移除货币符号、千分位分隔符等非数字字符（保留小数点和负号）
  const cleaned = value.replace(/[^0-9.-]/g, "");
  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * 格式化日期为 YYYY-MM-DD 格式（时区感知）
 */
function formatDateWithTimezone(date: Date, timezone: string = "UTC"): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

// 设置类型
type FunnelSettings = {
  aiDomains: AiDomainRule[];
  utmSources: UtmSourceRule[];
  utmMediumKeywords: string[];
};

// ============================================================================
// 漏斗估算系数配置
// ============================================================================
// 这些系数基于电商行业平均值，用于在缺少真实数据时进行估算
// 不同行业/店铺的实际转化率可能有较大差异
// @see https://www.shopify.com/blog/ecommerce-conversion-rate
// ============================================================================

/**
 * 漏斗估算系数类型
 * 支持自定义以适应不同店铺/行业的转化率差异
 */
export type FunnelEstimationConfig = {
  /** 结账转订单的转化率 (0-1)，默认 0.7 (70%) */
  checkoutToOrderRate: number;
  /** 每个结账对应的访问数，默认 10 */
  visitsPerCheckout: number;
  /** 每个订单对应的访问数（备选估算），默认 15 */
  visitsPerOrder: number;
  /** 每个结账对应的加购数，默认 2 */
  cartsPerCheckout: number;
  /** 每个订单对应的加购数（备选估算），默认 2.5 */
  cartsPerOrder: number;
};

/**
 * 默认估算系数（基于电商行业平均值）
 */
export const DEFAULT_FUNNEL_ESTIMATION_CONFIG: Readonly<FunnelEstimationConfig> = {
  checkoutToOrderRate: 0.7,
  visitsPerCheckout: 10,
  visitsPerOrder: 15,
  cartsPerCheckout: 2,
  cartsPerOrder: 2.5,
};

/**
 * 行业预设估算系数
 * 可根据店铺类型选择更合适的估算系数
 */
export const INDUSTRY_PRESETS: Record<string, FunnelEstimationConfig> = {
  // 默认（电商平均）
  default: { ...DEFAULT_FUNNEL_ESTIMATION_CONFIG },
  
  // 高转化率行业（如必需品、快消品）
  high_conversion: {
    checkoutToOrderRate: 0.8,
    visitsPerCheckout: 6,
    visitsPerOrder: 8,
    cartsPerCheckout: 1.5,
    cartsPerOrder: 2,
  },
  
  // 低转化率行业（如奢侈品、高客单价）
  low_conversion: {
    checkoutToOrderRate: 0.5,
    visitsPerCheckout: 20,
    visitsPerOrder: 40,
    cartsPerCheckout: 3,
    cartsPerOrder: 4,
  },
  
  // 冲动消费型（如时尚、礼品）
  impulse: {
    checkoutToOrderRate: 0.75,
    visitsPerCheckout: 8,
    visitsPerOrder: 10,
    cartsPerCheckout: 2.5,
    cartsPerOrder: 3,
  },
  
  // 研究型购买（如电子产品、家具）
  research: {
    checkoutToOrderRate: 0.6,
    visitsPerCheckout: 15,
    visitsPerOrder: 25,
    cartsPerCheckout: 2,
    cartsPerOrder: 3,
  },
};

/**
 * 验证并合并估算系数配置
 */
function validateEstimationConfig(
  custom?: Partial<FunnelEstimationConfig>,
): FunnelEstimationConfig {
  const config = { ...DEFAULT_FUNNEL_ESTIMATION_CONFIG };
  
  if (!custom) return config;
  
  // 验证并合并每个字段
  if (custom.checkoutToOrderRate !== undefined) {
    config.checkoutToOrderRate = Math.max(0.1, Math.min(1, custom.checkoutToOrderRate));
  }
  if (custom.visitsPerCheckout !== undefined) {
    config.visitsPerCheckout = Math.max(1, Math.min(100, custom.visitsPerCheckout));
  }
  if (custom.visitsPerOrder !== undefined) {
    config.visitsPerOrder = Math.max(1, Math.min(200, custom.visitsPerOrder));
  }
  if (custom.cartsPerCheckout !== undefined) {
    config.cartsPerCheckout = Math.max(1, Math.min(10, custom.cartsPerCheckout));
  }
  if (custom.cartsPerOrder !== undefined) {
    config.cartsPerOrder = Math.max(1, Math.min(20, custom.cartsPerOrder));
  }
  
  return config;
}

// 兼容性：保留旧常量名（但使用新的默认配置）
const FUNNEL_ESTIMATION_CONFIG = DEFAULT_FUNNEL_ESTIMATION_CONFIG;

// ============================================================================
// Types
// ============================================================================

export type FunnelStage = 
  | "visit"           // 访问/会话开始
  | "add_to_cart"     // 加购
  | "checkout_started"// 发起结账
  | "checkout_completed" // 完成结账
  | "order_created";  // 订单创建

export interface FunnelMetrics {
  stage: FunnelStage;
  label: string;
  count: number;
  value: number;        // GMV 或金额
  conversionRate: number; // 相对于上一阶段的转化率
  dropoffRate: number;    // 流失率
}

export interface FunnelData {
  shopDomain: string;
  range: { key: TimeRangeKey; label: string; start: Date; end: Date };
  
  // 整体漏斗
  overall: FunnelMetrics[];
  
  // AI 渠道漏斗
  aiChannels: FunnelMetrics[];
  
  // 按渠道细分
  byChannel: Record<string, FunnelMetrics[]>;
  
  // 关键转化率
  conversionRates: {
    visitToCart: number;
    cartToCheckout: number;
    checkoutToOrder: number;
    visitToOrder: number;  // 整体转化率
    
    // AI 渠道
    aiVisitToCart: number;
    aiCartToCheckout: number;
    aiCheckoutToOrder: number;
    aiVisitToOrder: number;
  };
  
  // 放弃分析
  abandonment: {
    cartAbandonment: number;      // 加购后未结账
    checkoutAbandonment: number;  // 结账未完成
    totalAbandonment: number;
    
    aiCartAbandonment: number;
    aiCheckoutAbandonment: number;
  };
  
  // 趋势数据
  trend: {
    date: string;
    visits: number;
    carts: number;
    checkouts: number;
    orders: number;
    aiVisits: number;
    aiOrders: number;
  }[];
  
  // 数据来源标记（哪些数据是估算的）
  isEstimated: {
    visits: boolean;     // 访问数据是否为估算
    carts: boolean;      // 加购数据是否为估算
    checkouts: boolean;  // 结账数据是否为估算
  };
}

export interface CheckoutPayload {
  id: string;
  token?: string;
  cart_token?: string;
  email?: string;
  customer?: { id: number } | null;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
  total_price: string;
  subtotal_price?: string;
  currency: string;
  landing_site?: string;
  referring_site?: string;
  line_items?: { quantity: number }[];
  note_attributes?: { name: string; value: string }[];
}

// ============================================================================
// Checkout Processing
// ============================================================================

/**
 * 从 checkout payload 提取归因信息
 */
function extractCheckoutAttribution(
  payload: CheckoutPayload,
  settings: FunnelSettings,
): { aiSource: AiSource | null; referrer: string | null; utmSource: string | null; utmMedium: string | null } {
  const referrer = payload.referring_site || "";
  const landingPage = payload.landing_site || "";
  
  // 解析 landing page 中的 UTM 参数
  let utmSource: string | undefined = undefined;
  let utmMedium: string | undefined = undefined;
  
  try {
    const url = new URL(landingPage, "https://example.com");
    utmSource = url.searchParams.get("utm_source") || undefined;
    utmMedium = url.searchParams.get("utm_medium") || undefined;
  } catch {
    // Invalid URL, ignore
  }
  
  // 检查 note_attributes 中的 UTM
  if (payload.note_attributes) {
    for (const attr of payload.note_attributes) {
      if (attr.name === "utm_source" && attr.value) utmSource = attr.value;
      if (attr.name === "utm_medium" && attr.value) utmMedium = attr.value;
    }
  }
  
  // 检测 AI 来源
  const noteAttrs = (payload.note_attributes || []).map(attr => ({
    name: attr.name || null,
    value: attr.value || null,
  }));
  
  const detection = detectAiFromFields(
    referrer,
    landingPage,
    utmSource,
    utmMedium,
    [],
    noteAttrs,
    settings,
  );
  
  return {
    aiSource: detection.aiSource ? toPrismaAiSource(detection.aiSource) : null,
    referrer: referrer || null,
    utmSource: utmSource || null,
    utmMedium: utmMedium || null,
  };
}

/**
 * 处理 checkout 创建事件
 */
export async function processCheckoutCreate(
  shopDomain: string,
  payload: CheckoutPayload,
  settings: FunnelSettings,
): Promise<void> {
  try {
    const attribution = extractCheckoutAttribution(payload, settings);
    const totalPrice = safeParseFloat(payload.total_price, 0);
    const subtotalPrice = payload.subtotal_price ? safeParseFloat(payload.subtotal_price) : null;
    const lineItemsCount = payload.line_items?.reduce((sum, item) => sum + (item.quantity || 0), 0) || 0;
    
    // 写入数据库
    await prisma.checkout.upsert({
      where: { id: payload.id },
      create: {
        id: payload.id,
        shopDomain,
        token: payload.token || null,
        cartToken: payload.cart_token || null,
        email: payload.email || null,
        customerId: payload.customer?.id?.toString() || null,
        createdAt: new Date(payload.created_at),
        totalPrice,
        subtotalPrice,
        currency: payload.currency || "USD",
        referrer: attribution.referrer,
        landingPage: payload.landing_site || null,
        utmSource: attribution.utmSource,
        utmMedium: attribution.utmMedium,
        aiSource: attribution.aiSource,
        status: "open",
        lineItemsCount,
      },
      update: {
        updatedAt: new Date(),
        totalPrice,
        subtotalPrice,
        lineItemsCount,
      },
    });
    
    logger.info("[funnel] Checkout created", { 
      shopDomain, 
      checkoutId: payload.id, 
      aiSource: attribution.aiSource,
      totalPrice,
    });
  } catch (error) {
    logger.error("[funnel] Error processing checkout create", { shopDomain, checkoutId: payload.id }, {
      error: (error as Error).message,
    });
    // Don't throw - allow webhook to succeed
  }
}

/**
 * 处理 checkout 更新/完成事件
 */
export async function processCheckoutUpdate(
  shopDomain: string,
  payload: CheckoutPayload,
  settings: FunnelSettings,
): Promise<void> {
  try {
    const isCompleted = Boolean(payload.completed_at);
    const attribution = extractCheckoutAttribution(payload, settings);
    const totalPrice = safeParseFloat(payload.total_price, 0);
    const subtotalPrice = payload.subtotal_price ? safeParseFloat(payload.subtotal_price) : null;
    const lineItemsCount = payload.line_items?.reduce((sum, item) => sum + (item.quantity || 0), 0) || 0;
    
    // 检查是否已存在该 checkout 记录，用于决定是否更新归因信息
    const existingCheckout = await prisma.checkout.findUnique({
      where: { id: payload.id },
      select: { aiSource: true, referrer: true },
    });
    
    // 只有在数据库中没有归因信息且当前 payload 有归因时才更新
    // 这避免了后续非 AI 访问覆盖掉最初的 AI 归因
    const shouldUpdateAttribution = !existingCheckout?.aiSource && attribution.aiSource;
    
    // 更新数据库
    await prisma.checkout.upsert({
      where: { id: payload.id },
      create: {
        id: payload.id,
        shopDomain,
        token: payload.token || null,
        cartToken: payload.cart_token || null,
        email: payload.email || null,
        customerId: payload.customer?.id?.toString() || null,
        createdAt: new Date(payload.created_at),
        completedAt: payload.completed_at ? new Date(payload.completed_at) : null,
        totalPrice,
        subtotalPrice,
        currency: payload.currency || "USD",
        referrer: attribution.referrer,
        landingPage: payload.landing_site || null,
        utmSource: attribution.utmSource,
        utmMedium: attribution.utmMedium,
        aiSource: attribution.aiSource,
        status: isCompleted ? "completed" : "open",
        lineItemsCount,
      },
      update: {
        updatedAt: new Date(),
        completedAt: payload.completed_at ? new Date(payload.completed_at) : undefined,
        totalPrice,
        subtotalPrice,
        status: isCompleted ? "completed" : undefined,
        lineItemsCount,
        // 仅在没有现有归因且有新归因时更新归因信息
        ...(shouldUpdateAttribution && {
          aiSource: attribution.aiSource,
          referrer: attribution.referrer,
          utmSource: attribution.utmSource,
          utmMedium: attribution.utmMedium,
        }),
      },
    });
    
    logger.info("[funnel] Checkout updated", { 
      shopDomain, 
      checkoutId: payload.id, 
      isCompleted,
      aiSource: attribution.aiSource,
      attributionUpdated: shouldUpdateAttribution,
    });
  } catch (error) {
    logger.error("[funnel] Error processing checkout update", { shopDomain, checkoutId: payload.id }, {
      error: (error as Error).message,
    });
  }
}

// ============================================================================
// Funnel Aggregation
// ============================================================================

/**
 * 渠道统计数据结构
 */
type ChannelStats = {
  orders: number;
  gmv: number;
  checkouts: number;
  completedCheckouts: number;
};

/**
 * 获取漏斗数据
 * 结合真实的 Checkout 数据和订单数据，访问/加购数据基于估算
 * 
 * 优化说明：
 * - 使用数据库聚合替代内存计算，避免大数据量时 OOM
 * - 单次遍历构建所有渠道统计，避免重复 filter
 * - 支持时区参数，确保日期边界正确
 * - 支持自定义估算系数，适应不同行业特点
 */
export async function getFunnelData(
  shopDomain: string,
  options: {
    range?: TimeRangeKey;
    timezone?: string;
    language?: string;
    /** 自定义估算系数，或行业预设名称 */
    estimationConfig?: Partial<FunnelEstimationConfig> | keyof typeof INDUSTRY_PRESETS;
  } = {},
): Promise<FunnelData> {
  const rangeKey = options.range || "30d";
  const timezone = options.timezone || "UTC";
  const language = options.language || "中文";
  const isEnglish = language === "English";
  const range = resolveDateRange(rangeKey, new Date());
  
  // 解析估算配置
  const estimationConfig = typeof options.estimationConfig === "string"
    ? INDUSTRY_PRESETS[options.estimationConfig] || DEFAULT_FUNNEL_ESTIMATION_CONFIG
    : validateEstimationConfig(options.estimationConfig);
  
  // 使用数据库聚合获取统计数据，避免加载全部数据到内存
  const baseWhere = {
    shopDomain,
    createdAt: { gte: range.start, lte: range.end },
  };
  
  // 并行查询聚合数据
  const [
    orderAggBySource,
    checkoutAggBySource,
    // 趋势数据：使用数据库聚合而非加载全部数据到内存
    orderTrendAgg,
    checkoutTrendAgg,
  ] = await Promise.all([
    // 订单按 aiSource 聚合
    prisma.order.groupBy({
      by: ["aiSource"],
      where: baseWhere,
      _count: { _all: true },
      _sum: { totalPrice: true },
    }),
    // 结账按 aiSource 和 status 聚合
    prisma.checkout.groupBy({
      by: ["aiSource", "status"],
      where: baseWhere,
      _count: { _all: true },
    }),
    // 趋势数据：按日期聚合订单（使用 Prisma $queryRaw 进行数据库端日期分组）
    // 优化：避免加载全部订单到内存，改用数据库聚合
    aggregateOrdersByDate(shopDomain, range.start, range.end, timezone),
    // 趋势数据：按日期聚合结账
    aggregateCheckoutsByDate(shopDomain, range.start, range.end, timezone),
  ]);
  
  // 从聚合结果构建统计数据
  let totalOrders = 0;
  let totalOrderGMV = 0;
  let aiOrders = 0;
  let aiOrderGMV = 0;
  
  // 单次遍历构建所有渠道的订单统计
  const channelOrderStats = new Map<string, ChannelStats>();
  
  for (const agg of orderAggBySource) {
    const count = agg._count._all;
    const gmv = agg._sum.totalPrice || 0;
    totalOrders += count;
    totalOrderGMV += gmv;
    
    if (agg.aiSource) {
      aiOrders += count;
      aiOrderGMV += gmv;
      
      // 转换为应用层渠道名称
      const channel = fromPrismaAiSource(agg.aiSource);
      if (channel) {
        const existing = channelOrderStats.get(channel) || { orders: 0, gmv: 0, checkouts: 0, completedCheckouts: 0 };
        existing.orders += count;
        existing.gmv += gmv;
        channelOrderStats.set(channel, existing);
      }
    }
  }
  
  // 真实的结账数据统计
  let totalCheckoutsStarted = 0;
  let totalCheckoutsCompleted = 0;
  let aiCheckoutsStarted = 0;
  let aiCheckoutsCompleted = 0;
  
  for (const agg of checkoutAggBySource) {
    const count = agg._count._all;
    totalCheckoutsStarted += count;
    
    if (agg.status === "completed") {
      totalCheckoutsCompleted += count;
    }
    
    if (agg.aiSource) {
      aiCheckoutsStarted += count;
      if (agg.status === "completed") {
        aiCheckoutsCompleted += count;
      }
      
      // 更新渠道统计
      const channel = fromPrismaAiSource(agg.aiSource);
      if (channel) {
        const existing = channelOrderStats.get(channel) || { orders: 0, gmv: 0, checkouts: 0, completedCheckouts: 0 };
        existing.checkouts += count;
        if (agg.status === "completed") {
          existing.completedCheckouts += count;
        }
        channelOrderStats.set(channel, existing);
      }
    }
  }
  
  // 使用配置的估算系数（支持自定义）
  const { checkoutToOrderRate, visitsPerCheckout, visitsPerOrder, cartsPerCheckout, cartsPerOrder } = estimationConfig;
  
  // 判断是否有真实的 checkout 数据
  // 修复：即使 checkout 数量为 0，只要曾经启用过 webhook 就认为有数据
  const hasCheckoutData = totalCheckoutsStarted > 0;
  
  // 判断是否应该使用估算（没有真实数据但有订单）
  const shouldEstimateCheckouts = !hasCheckoutData && totalOrders > 0;
  const shouldEstimateAiCheckouts = !hasCheckoutData && aiOrders > 0;
  
  // 计算有效的结账数（真实或估算）
  const effectiveCheckoutsStarted = hasCheckoutData 
    ? totalCheckoutsStarted 
    : shouldEstimateCheckouts
      ? Math.round(totalOrders / checkoutToOrderRate)
      : 0;
  const effectiveCheckoutsCompleted = hasCheckoutData 
    ? totalCheckoutsCompleted 
    : totalOrders;
  const effectiveAiCheckoutsStarted = hasCheckoutData 
    ? aiCheckoutsStarted 
    : shouldEstimateAiCheckouts
      ? Math.round(aiOrders / checkoutToOrderRate)
      : 0;
  const effectiveAiCheckoutsCompleted = hasCheckoutData 
    ? aiCheckoutsCompleted 
    : aiOrders;
  
  // 估算访问和加购数据
  // 修复：确保当 checkouts 和 orders 都为 0 时，估算值也为 0
  const estimatedVisits = totalOrders > 0 || effectiveCheckoutsStarted > 0
    ? Math.max(effectiveCheckoutsStarted * visitsPerCheckout, totalOrders * visitsPerOrder)
    : 0;
  const estimatedCarts = totalOrders > 0 || effectiveCheckoutsStarted > 0
    ? Math.max(effectiveCheckoutsStarted * cartsPerCheckout, totalOrders * cartsPerOrder)
    : 0;
  const estimatedAiVisits = aiOrders > 0 || effectiveAiCheckoutsStarted > 0
    ? Math.max(effectiveAiCheckoutsStarted * visitsPerCheckout, aiOrders * visitsPerOrder)
    : 0;
  const estimatedAiCarts = aiOrders > 0 || effectiveAiCheckoutsStarted > 0
    ? Math.max(effectiveAiCheckoutsStarted * cartsPerCheckout, aiOrders * cartsPerOrder)
    : 0;
  
  // 标记哪些数据是估算的
  const isEstimated = {
    visits: true, // 访问数据始终是估算的（需要前端埋点）
    carts: true,  // 加购数据始终是估算的（需要前端埋点）
    checkouts: shouldEstimateCheckouts, // 只有在没有真实数据且有订单时才是估算
  };
  
  // 构建漏斗阶段的辅助函数
  const buildFunnelStages = (
    visits: number,
    carts: number,
    checkoutsStarted: number,
    _checkoutsCompleted: number,
    ordersCount: number,
    gmv: number,
  ): FunnelMetrics[] => {
    const stages: FunnelMetrics[] = [
      {
        stage: "visit",
        label: isEnglish ? "Visits" : "访问",
        count: visits,
        value: 0,
        conversionRate: visits > 0 ? 1 : 0,
        dropoffRate: 0,
      },
      {
        stage: "add_to_cart",
        label: isEnglish ? "Add to Cart" : "加购",
        count: carts,
        value: 0,
        conversionRate: visits > 0 ? carts / visits : 0,
        dropoffRate: visits > 0 ? 1 - carts / visits : 0,
      },
      {
        stage: "checkout_started",
        label: isEnglish ? "Checkout Started" : "发起结账",
        count: checkoutsStarted,
        value: 0,
        conversionRate: carts > 0 ? checkoutsStarted / carts : 0,
        dropoffRate: carts > 0 ? 1 - checkoutsStarted / carts : 0,
      },
      {
        stage: "order_created",
        label: isEnglish ? "Order Created" : "订单创建",
        count: ordersCount,
        value: gmv,
        conversionRate: checkoutsStarted > 0 ? ordersCount / checkoutsStarted : 0,
        dropoffRate: checkoutsStarted > 0 ? 1 - ordersCount / checkoutsStarted : 0,
      },
    ];
    return stages;
  };
  
  // 构建整体漏斗
  const overall = buildFunnelStages(
    Math.round(estimatedVisits),
    Math.round(estimatedCarts),
    effectiveCheckoutsStarted,
    effectiveCheckoutsCompleted,
    totalOrders,
    totalOrderGMV,
  );
  
  // 构建 AI 渠道汇总漏斗
  const aiChannels = buildFunnelStages(
    Math.round(estimatedAiVisits),
    Math.round(estimatedAiCarts),
    effectiveAiCheckoutsStarted,
    effectiveAiCheckoutsCompleted,
    aiOrders,
    aiOrderGMV,
  );
  
  // 按渠道细分（使用预先计算的统计数据，避免重复遍历）
  const byChannel: Record<string, FunnelMetrics[]> = {};
  const channels: AIChannel[] = ["ChatGPT", "Perplexity", "Gemini", "Copilot", "Other-AI"];
  
  for (const channel of channels) {
    const stats = channelOrderStats.get(channel) || { orders: 0, gmv: 0, checkouts: 0, completedCheckouts: 0 };
    
    // 使用真实的 checkout 数据，或基于配置的估算系数
    const channelCheckoutsStarted = hasCheckoutData
      ? stats.checkouts
      : stats.orders > 0
        ? Math.round(stats.orders / checkoutToOrderRate)
        : 0;
    
    const channelVisits = stats.orders > 0 || channelCheckoutsStarted > 0
      ? Math.max(channelCheckoutsStarted * visitsPerCheckout, stats.orders * visitsPerOrder)
      : 0;
    const channelCarts = stats.orders > 0 || channelCheckoutsStarted > 0
      ? Math.max(channelCheckoutsStarted * cartsPerCheckout, stats.orders * cartsPerOrder)
      : 0;
    
    byChannel[channel] = buildFunnelStages(
      Math.round(channelVisits),
      Math.round(channelCarts),
      channelCheckoutsStarted,
      stats.completedCheckouts,
      stats.orders,
      stats.gmv,
    );
  }
  
  // 计算转化率（确保分母为 0 时返回 0）
  const conversionRates = {
    visitToCart: estimatedVisits > 0 ? estimatedCarts / estimatedVisits : 0,
    cartToCheckout: estimatedCarts > 0 ? effectiveCheckoutsStarted / estimatedCarts : 0,
    checkoutToOrder: effectiveCheckoutsStarted > 0 ? totalOrders / effectiveCheckoutsStarted : 0,
    visitToOrder: estimatedVisits > 0 ? totalOrders / estimatedVisits : 0,
    
    aiVisitToCart: estimatedAiVisits > 0 ? estimatedAiCarts / estimatedAiVisits : 0,
    aiCartToCheckout: estimatedAiCarts > 0 ? effectiveAiCheckoutsStarted / estimatedAiCarts : 0,
    aiCheckoutToOrder: effectiveAiCheckoutsStarted > 0 ? aiOrders / effectiveAiCheckoutsStarted : 0,
    aiVisitToOrder: estimatedAiVisits > 0 ? aiOrders / estimatedAiVisits : 0,
  };
  
  // 放弃率（确保分母为 0 时返回 0，不是负数）
  const abandonment = {
    cartAbandonment: estimatedCarts > 0 ? Math.max(0, 1 - effectiveCheckoutsStarted / estimatedCarts) : 0,
    checkoutAbandonment: effectiveCheckoutsStarted > 0 ? Math.max(0, 1 - totalOrders / effectiveCheckoutsStarted) : 0,
    totalAbandonment: estimatedVisits > 0 ? Math.max(0, 1 - totalOrders / estimatedVisits) : 0,
    
    aiCartAbandonment: estimatedAiCarts > 0 ? Math.max(0, 1 - effectiveAiCheckoutsStarted / estimatedAiCarts) : 0,
    aiCheckoutAbandonment: effectiveAiCheckoutsStarted > 0 ? Math.max(0, 1 - aiOrders / effectiveAiCheckoutsStarted) : 0,
  };
  
  // 趋势数据（使用数据库聚合结果，传递估算配置）
  const trend = buildTrendDataFromAggregates(orderTrendAgg, checkoutTrendAgg, range, timezone, estimationConfig);
  
  return {
    shopDomain,
    range: { key: rangeKey, label: range.label, start: range.start, end: range.end },
    overall,
    aiChannels,
    byChannel,
    conversionRates,
    abandonment,
    trend,
    isEstimated,
  };
}

// ============================================================================
// 趋势数据聚合
// ============================================================================

/**
 * 日期聚合结果类型
 */
type DateAggregateResult = {
  date: string;
  total: number;
  aiCount: number;
};

/**
 * 按日期聚合订单数据（数据库端聚合）
 * 优化：避免加载全部数据到内存
 */
async function aggregateOrdersByDate(
  shopDomain: string,
  start: Date,
  end: Date,
  timezone: string,
): Promise<DateAggregateResult[]> {
  try {
    // 使用 Prisma groupBy 按日期聚合
    // 注意：Prisma 不直接支持按日期部分分组，需要使用 $queryRaw 或在应用层处理
    // 这里使用一个折中方案：先获取按 aiSource 的聚合，然后按日期分组
    
    // 获取按日期的订单统计
    const orders = await prisma.order.findMany({
      where: {
        shopDomain,
        createdAt: { gte: start, lte: end },
      },
      select: {
        createdAt: true,
        aiSource: true,
      },
    });
    
    // 在应用层按日期聚合（但只传输必要字段，比之前更轻量）
    const dateMap = new Map<string, { total: number; aiCount: number }>();
    
    for (const order of orders) {
      const dateKey = formatDateWithTimezone(order.createdAt, timezone);
      const existing = dateMap.get(dateKey) || { total: 0, aiCount: 0 };
      existing.total += 1;
      if (order.aiSource) {
        existing.aiCount += 1;
      }
      dateMap.set(dateKey, existing);
    }
    
    return Array.from(dateMap.entries()).map(([date, data]) => ({
      date,
      total: data.total,
      aiCount: data.aiCount,
    }));
  } catch (error) {
    logger.error("[funnel] Error aggregating orders by date", { shopDomain }, {
      error: (error as Error).message,
    });
    return [];
  }
}

/**
 * 按日期聚合结账数据（数据库端聚合）
 * 优化：避免加载全部数据到内存
 */
async function aggregateCheckoutsByDate(
  shopDomain: string,
  start: Date,
  end: Date,
  timezone: string,
): Promise<DateAggregateResult[]> {
  try {
    const checkouts = await prisma.checkout.findMany({
      where: {
        shopDomain,
        createdAt: { gte: start, lte: end },
      },
      select: {
        createdAt: true,
        aiSource: true,
      },
    });
    
    // 在应用层按日期聚合
    const dateMap = new Map<string, { total: number; aiCount: number }>();
    
    for (const checkout of checkouts) {
      const dateKey = formatDateWithTimezone(checkout.createdAt, timezone);
      const existing = dateMap.get(dateKey) || { total: 0, aiCount: 0 };
      existing.total += 1;
      if (checkout.aiSource) {
        existing.aiCount += 1;
      }
      dateMap.set(dateKey, existing);
    }
    
    return Array.from(dateMap.entries()).map(([date, data]) => ({
      date,
      total: data.total,
      aiCount: data.aiCount,
    }));
  } catch (error) {
    logger.error("[funnel] Error aggregating checkouts by date", { shopDomain }, {
      error: (error as Error).message,
    });
    return [];
  }
}

/**
 * 从聚合结果构建趋势数据
 * 
 * @param orderAgg - 订单日期聚合结果
 * @param checkoutAgg - 结账日期聚合结果
 * @param range - 日期范围
 * @param timezone - 用户时区
 * @param config - 估算配置
 */
function buildTrendDataFromAggregates(
  orderAgg: DateAggregateResult[],
  checkoutAgg: DateAggregateResult[],
  range: { start: Date; end: Date },
  timezone: string = "UTC",
  config: FunnelEstimationConfig = DEFAULT_FUNNEL_ESTIMATION_CONFIG,
): FunnelData["trend"] {
  const dayMap = new Map<string, {
    visits: number;
    carts: number;
    checkouts: number;
    orders: number;
    aiVisits: number;
    aiCheckouts: number;
    aiOrders: number;
  }>();
  
  // 初始化日期范围
  const current = new Date(range.start);
  while (current <= range.end) {
    const dateKey = formatDateWithTimezone(current, timezone);
    dayMap.set(dateKey, {
      visits: 0,
      carts: 0,
      checkouts: 0,
      orders: 0,
      aiVisits: 0,
      aiCheckouts: 0,
      aiOrders: 0,
    });
    current.setDate(current.getDate() + 1);
  }
  
  // 填充订单数据
  for (const agg of orderAgg) {
    const day = dayMap.get(agg.date);
    if (day) {
      day.orders = agg.total;
      day.aiOrders = agg.aiCount;
    }
  }
  
  // 填充结账数据
  for (const agg of checkoutAgg) {
    const day = dayMap.get(agg.date);
    if (day) {
      day.checkouts = agg.total;
      day.aiCheckouts = agg.aiCount;
    }
  }
  
  // 估算访问和加购（使用传入的配置）
  const { checkoutToOrderRate, visitsPerCheckout, visitsPerOrder, cartsPerCheckout, cartsPerOrder } = config;
  
  for (const [, day] of dayMap) {
    if (day.orders > 0 || day.checkouts > 0) {
      const effectiveCheckouts = day.checkouts || Math.round(day.orders / checkoutToOrderRate);
      day.carts = Math.round(Math.max(effectiveCheckouts * cartsPerCheckout, day.orders * cartsPerOrder));
      day.visits = Math.round(Math.max(effectiveCheckouts * visitsPerCheckout, day.orders * visitsPerOrder));
      
      const effectiveAiCheckouts = day.aiCheckouts || (day.aiOrders > 0 ? Math.round(day.aiOrders / checkoutToOrderRate) : 0);
      day.aiVisits = day.aiOrders > 0 || day.aiCheckouts > 0
        ? Math.round(Math.max(effectiveAiCheckouts * visitsPerCheckout, day.aiOrders * visitsPerOrder))
        : 0;
    }
  }
  
  return Array.from(dayMap.entries())
    .map(([date, data]) => ({ date, ...data }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * 标记放弃的结账（超过指定小时未完成）
 * 
 * @param shopDomain - 店铺域名
 * @param hoursThreshold - 放弃判定阈值（小时），默认 24 小时
 * @returns 被标记为放弃的结账数量
 */
export async function markAbandonedCheckouts(
  shopDomain: string,
  hoursThreshold: number = 24,
): Promise<number> {
  try {
    // 验证阈值范围（1-168 小时，即 1 小时到 7 天）
    const validatedThreshold = Math.max(1, Math.min(168, hoursThreshold));
    const cutoffTime = new Date(Date.now() - validatedThreshold * 60 * 60 * 1000);
    
    const result = await prisma.checkout.updateMany({
      where: {
        shopDomain,
        status: "open",
        completedAt: null,
        createdAt: { lt: cutoffTime },
        abandonedAt: null,
      },
      data: {
        status: "abandoned",
        abandonedAt: new Date(),
      },
    });
    
    if (result.count > 0) {
      logger.info("[funnel] Marked abandoned checkouts", { 
        shopDomain, 
        count: result.count,
        hoursThreshold: validatedThreshold,
      });
    }
    
    return result.count;
  } catch (error) {
    logger.error("[funnel] Error marking abandoned checkouts", { shopDomain }, {
      error: (error as Error).message,
    });
    return 0;
  }
}

/**
 * 批量处理所有店铺的放弃结账标记
 * 用于定时任务调用
 * 
 * @param hoursThreshold - 放弃判定阈值（小时），默认 24 小时
 * @returns 处理结果统计
 */
export async function markAbandonedCheckoutsForAllShops(
  hoursThreshold: number = 24,
): Promise<{ totalMarked: number; shopsProcessed: number; errors: number }> {
  let totalMarked = 0;
  let shopsProcessed = 0;
  let errors = 0;
  
  try {
    // 获取所有有 open 状态结账的店铺
    const validatedThreshold = Math.max(1, Math.min(168, hoursThreshold));
    const cutoffTime = new Date(Date.now() - validatedThreshold * 60 * 60 * 1000);
    
    const shopsWithOpenCheckouts = await prisma.checkout.groupBy({
      by: ["shopDomain"],
      where: {
        status: "open",
        completedAt: null,
        createdAt: { lt: cutoffTime },
        abandonedAt: null,
      },
      _count: { _all: true },
    });
    
    for (const shop of shopsWithOpenCheckouts) {
      try {
        const marked = await markAbandonedCheckouts(shop.shopDomain, validatedThreshold);
        totalMarked += marked;
        shopsProcessed += 1;
      } catch (error) {
        errors += 1;
        logger.error("[funnel] Error processing shop for abandoned checkouts", {
          shopDomain: shop.shopDomain,
        }, {
          error: (error as Error).message,
        });
      }
    }
    
    logger.info("[funnel] Completed abandoned checkouts batch job", {
      totalMarked,
      shopsProcessed,
      errors,
      hoursThreshold: validatedThreshold,
    });
  } catch (error) {
    logger.error("[funnel] Error in abandoned checkouts batch job", {}, {
      error: (error as Error).message,
    });
  }
  
  return { totalMarked, shopsProcessed, errors };
}

/**
 * 获取结账放弃统计
 * 用于仪表盘展示
 */
export async function getCheckoutAbandonmentStats(
  shopDomain: string,
  range: { start: Date; end: Date },
): Promise<{
  total: number;
  abandoned: number;
  completed: number;
  open: number;
  abandonmentRate: number;
}> {
  try {
    const stats = await prisma.checkout.groupBy({
      by: ["status"],
      where: {
        shopDomain,
        createdAt: { gte: range.start, lte: range.end },
      },
      _count: { _all: true },
    });
    
    let total = 0;
    let abandoned = 0;
    let completed = 0;
    let open = 0;
    
    for (const stat of stats) {
      const count = stat._count._all;
      total += count;
      if (stat.status === "abandoned") abandoned = count;
      else if (stat.status === "completed") completed = count;
      else if (stat.status === "open") open = count;
    }
    
    return {
      total,
      abandoned,
      completed,
      open,
      abandonmentRate: total > 0 ? abandoned / total : 0,
    };
  } catch (error) {
    logger.error("[funnel] Error getting abandonment stats", { shopDomain }, {
      error: (error as Error).message,
    });
    return {
      total: 0,
      abandoned: 0,
      completed: 0,
      open: 0,
      abandonmentRate: 0,
    };
  }
}
