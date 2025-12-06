/**
 * 漏斗归因服务
 * 支持更细粒度的漏斗分析：访问 → 加购 → 结账 → 成交
 */

import prisma from "../db.server";
import { resolveDateRange, type TimeRangeKey, type AIChannel, type AiDomainRule, type UtmSourceRule } from "./aiData";
import { toPrismaAiSource } from "./aiSourceMapper";
import { detectAiFromFields } from "./aiAttribution";
import { logger } from "./logger.server";
import type { AiSource } from "@prisma/client";

// 设置类型
type FunnelSettings = {
  aiDomains: AiDomainRule[];
  utmSources: UtmSourceRule[];
  utmMediumKeywords: string[];
};

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
    const totalPrice = parseFloat(payload.total_price || "0");
    const subtotalPrice = payload.subtotal_price ? parseFloat(payload.subtotal_price) : null;
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
    const totalPrice = parseFloat(payload.total_price || "0");
    const subtotalPrice = payload.subtotal_price ? parseFloat(payload.subtotal_price) : null;
    const lineItemsCount = payload.line_items?.reduce((sum, item) => sum + (item.quantity || 0), 0) || 0;
    
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
        // 如果之前没有归因信息，现在补充
        aiSource: attribution.aiSource || undefined,
        referrer: attribution.referrer || undefined,
        utmSource: attribution.utmSource || undefined,
        utmMedium: attribution.utmMedium || undefined,
      },
    });
    
    logger.info("[funnel] Checkout updated", { 
      shopDomain, 
      checkoutId: payload.id, 
      isCompleted,
      aiSource: attribution.aiSource,
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
 * 获取漏斗数据
 * 结合真实的 Checkout 数据和订单数据，访问/加购数据基于估算
 */
export async function getFunnelData(
  shopDomain: string,
  options: {
    range?: TimeRangeKey;
    timezone?: string;
    language?: string;
  } = {},
): Promise<FunnelData> {
  const rangeKey = options.range || "30d";
  const language = options.language || "中文";
  const isEnglish = language === "English";
  const range = resolveDateRange(rangeKey, new Date());
  
  // 并行查询订单和结账数据
  const [orders, checkouts] = await Promise.all([
    prisma.order.findMany({
      where: {
        shopDomain,
        createdAt: { gte: range.start, lte: range.end },
      },
      select: {
        id: true,
        aiSource: true,
        totalPrice: true,
        createdAt: true,
      },
    }),
    prisma.checkout.findMany({
      where: {
        shopDomain,
        createdAt: { gte: range.start, lte: range.end },
      },
      select: {
        id: true,
        aiSource: true,
        totalPrice: true,
        createdAt: true,
        status: true,
        completedAt: true,
      },
    }),
  ]);
  
  // 订单统计
  const totalOrders = orders.length;
  const totalOrderGMV = orders.reduce((sum: number, o) => sum + o.totalPrice, 0);
  const aiOrders = orders.filter(o => o.aiSource).length;
  const aiOrderGMV = orders.filter(o => o.aiSource).reduce((sum: number, o) => sum + o.totalPrice, 0);
  
  // 真实的结账数据
  const totalCheckoutsStarted = checkouts.length;
  const _totalCheckoutsCompleted = checkouts.filter(c => c.status === "completed" || c.completedAt).length;
  const aiCheckoutsStarted = checkouts.filter(c => c.aiSource).length;
  const _aiCheckoutsCompleted = checkouts.filter(c => c.aiSource && (c.status === "completed" || c.completedAt)).length;
  
  // 如果没有 checkout 数据，使用估算值（向后兼容）
  const hasCheckoutData = totalCheckoutsStarted > 0;
  const effectiveCheckoutsStarted = hasCheckoutData 
    ? totalCheckoutsStarted 
    : Math.round(totalOrders / 0.7);
  const effectiveAiCheckoutsStarted = hasCheckoutData 
    ? aiCheckoutsStarted 
    : Math.round(aiOrders / 0.7);
  
  // 访问和加购数据仍然需要估算（需要前端埋点才能获取真实数据）
  // 使用保守的估算系数
  const estimatedVisits = Math.max(effectiveCheckoutsStarted * 10, totalOrders * 15);
  const estimatedCarts = Math.max(effectiveCheckoutsStarted * 2, totalOrders * 2.5);
  const estimatedAiVisits = Math.max(effectiveAiCheckoutsStarted * 10, aiOrders * 15);
  const estimatedAiCarts = Math.max(effectiveAiCheckoutsStarted * 2, aiOrders * 2.5);
  
  // 构建漏斗阶段
  const buildFunnelStages = (
    visits: number,
    carts: number,
    checkoutsStarted: number,
    checkoutsCompleted: number,
    ordersCount: number,
    gmv: number,
  ): FunnelMetrics[] => {
    const stages: FunnelMetrics[] = [
      {
        stage: "visit",
        label: isEnglish ? "Visits" : "访问",
        count: visits,
        value: 0,
        conversionRate: visits > 0 ? 1 : 0, // 当没有访问时显示 0% 而不是 100%
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
  
  const overall = buildFunnelStages(
    Math.round(estimatedVisits),
    Math.round(estimatedCarts),
    effectiveCheckoutsStarted,
    totalOrders, // checkoutsCompleted ≈ orders
    totalOrders,
    totalOrderGMV,
  );
  
  const aiChannels = buildFunnelStages(
    Math.round(estimatedAiVisits),
    Math.round(estimatedAiCarts),
    effectiveAiCheckoutsStarted,
    aiOrders, // checkoutsCompleted ≈ orders
    aiOrders,
    aiOrderGMV,
  );
  
  // 按渠道细分
  const byChannel: Record<string, FunnelMetrics[]> = {};
  const channels: AIChannel[] = ["ChatGPT", "Perplexity", "Gemini", "Copilot", "Other-AI"];
  
  for (const channel of channels) {
    const prismaSource = toPrismaAiSource(channel);
    const channelOrders = orders.filter((o: { aiSource: AiSource | null }) => o.aiSource === prismaSource).length;
    const channelGMV = orders
      .filter((o: { aiSource: AiSource | null }) => o.aiSource === prismaSource)
      .reduce((sum: number, o: { totalPrice: number }) => sum + o.totalPrice, 0);
    
    // 使用真实的 checkout 数据
    const channelCheckoutsStarted = hasCheckoutData
      ? checkouts.filter(c => c.aiSource === prismaSource).length
      : Math.round(channelOrders / 0.7);
    
    const channelVisits = Math.max(channelCheckoutsStarted * 10, channelOrders * 15);
    const channelCarts = Math.max(channelCheckoutsStarted * 2, channelOrders * 2.5);
    
    byChannel[channel] = buildFunnelStages(
      Math.round(channelVisits),
      Math.round(channelCarts),
      channelCheckoutsStarted,
      channelOrders,
      channelOrders,
      channelGMV,
    );
  }
  
  // 计算转化率
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
  
  // 放弃率
  const abandonment = {
    cartAbandonment: estimatedCarts > 0 ? 1 - effectiveCheckoutsStarted / estimatedCarts : 0,
    checkoutAbandonment: effectiveCheckoutsStarted > 0 ? 1 - totalOrders / effectiveCheckoutsStarted : 0,
    totalAbandonment: estimatedVisits > 0 ? 1 - totalOrders / estimatedVisits : 0,
    
    aiCartAbandonment: estimatedAiCarts > 0 ? 1 - effectiveAiCheckoutsStarted / estimatedAiCarts : 0,
    aiCheckoutAbandonment: effectiveAiCheckoutsStarted > 0 ? 1 - aiOrders / effectiveAiCheckoutsStarted : 0,
  };
  
  // 趋势数据（按天聚合）
  const trend = buildTrendData(orders, checkouts, range);
  
  return {
    shopDomain,
    range: { key: rangeKey, label: range.label, start: range.start, end: range.end },
    overall,
    aiChannels,
    byChannel,
    conversionRates,
    abandonment,
    trend,
  };
}

/**
 * 构建趋势数据
 */
function buildTrendData(
  orders: { createdAt: Date; aiSource: AiSource | null }[],
  checkouts: { createdAt: Date; aiSource: AiSource | null }[],
  range: { start: Date; end: Date },
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
    const dateKey = current.toISOString().slice(0, 10);
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
  
  // 聚合真实的 checkout 数据
  for (const checkout of checkouts) {
    const dateKey = checkout.createdAt.toISOString().slice(0, 10);
    const day = dayMap.get(dateKey);
    if (day) {
      day.checkouts += 1;
      if (checkout.aiSource) {
        day.aiCheckouts += 1;
      }
    }
  }
  
  // 聚合订单数据
  for (const order of orders) {
    const dateKey = order.createdAt.toISOString().slice(0, 10);
    const day = dayMap.get(dateKey);
    if (day) {
      day.orders += 1;
      if (order.aiSource) {
        day.aiOrders += 1;
      }
    }
  }
  
  // 估算访问和加购（基于订单和结账数据）
  for (const [, day] of dayMap) {
    const effectiveCheckouts = day.checkouts || Math.round(day.orders / 0.7);
    day.carts = Math.round(Math.max(effectiveCheckouts * 2, day.orders * 2.5));
    day.visits = Math.round(Math.max(effectiveCheckouts * 10, day.orders * 15));
    
    const effectiveAiCheckouts = day.aiCheckouts || Math.round(day.aiOrders / 0.7);
    day.aiVisits = Math.round(Math.max(effectiveAiCheckouts * 10, day.aiOrders * 15));
  }
  
  return Array.from(dayMap.entries())
    .map(([date, data]) => ({ date, ...data }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * 标记放弃的结账（超过指定小时未完成）
 */
export async function markAbandonedCheckouts(
  shopDomain: string,
  hoursThreshold: number = 24,
): Promise<number> {
  try {
    const cutoffTime = new Date(Date.now() - hoursThreshold * 60 * 60 * 1000);
    
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
        hoursThreshold,
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
