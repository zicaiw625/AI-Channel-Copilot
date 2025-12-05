/**
 * 漏斗归因服务
 * 支持更细粒度的漏斗分析：访问 → 加购 → 结账 → 成交
 */

import prisma from "../db.server";
import { resolveDateRange, type TimeRangeKey, type AIChannel, type AiDomainRule, type UtmSourceRule } from "./aiData";
import { fromPrismaAiSource, toPrismaAiSource } from "./aiSourceMapper";
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
 * 注意：需要先运行 prisma migrate 创建 Checkout 表
 */
export async function processCheckoutCreate(
  shopDomain: string,
  payload: CheckoutPayload,
  settings: FunnelSettings,
): Promise<void> {
  try {
    const attribution = extractCheckoutAttribution(payload, settings);
    
    // TODO: 在运行 prisma migrate 后启用数据库写入
    // 当前仅记录日志，等待数据库迁移完成
    logger.info("[funnel] Checkout created (pending migration)", { 
      shopDomain, 
      checkoutId: payload.id, 
      aiSource: attribution.aiSource,
      totalPrice: payload.total_price,
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
 * 注意：需要先运行 prisma migrate 创建 Checkout 表
 */
export async function processCheckoutUpdate(
  shopDomain: string,
  payload: CheckoutPayload,
  settings: FunnelSettings,
): Promise<void> {
  try {
    const isCompleted = Boolean(payload.completed_at);
    const attribution = extractCheckoutAttribution(payload, settings);
    
    // TODO: 在运行 prisma migrate 后启用数据库写入
    logger.info("[funnel] Checkout updated (pending migration)", { 
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
 * 基于现有订单数据估算漏斗指标（在 Checkout 表迁移完成前使用估算值）
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
  
  // 仅查询订单数据（Checkout 表尚未迁移）
  const orders = await prisma.order.findMany({
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
  });
  
  // 基于订单数据估算漏斗各阶段
  // 典型电商转化率：访问→加购 10-15%, 加购→结账 30-50%, 结账→订单 60-80%
  const totalOrders = orders.length;
  const totalOrderGMV = orders.reduce((sum: number, o) => sum + o.totalPrice, 0);
  
  // 反推估算
  const totalCheckoutsStarted = Math.round(totalOrders / 0.7); // 假设结账完成率 70%
  const totalCheckoutsCompleted = totalOrders;
  
  const aiOrders = orders.filter(o => o.aiSource).length;
  const aiOrderGMV = orders.filter(o => o.aiSource).reduce((sum: number, o) => sum + o.totalPrice, 0);
  const aiCheckoutsStarted = Math.round(aiOrders / 0.7);
  const aiCheckoutsCompleted = aiOrders;
  
  // 由于没有真实的 session 和 cart 数据，我们用估算值
  // 实际中这些数据需要从 Shopify 的 analytics API 或前端埋点获取
  const estimatedVisits = Math.max(totalCheckoutsStarted * 10, totalOrders * 20);
  const estimatedCarts = Math.max(totalCheckoutsStarted * 2, totalOrders * 3);
  const estimatedAiVisits = Math.max(aiCheckoutsStarted * 10, aiOrders * 20);
  const estimatedAiCarts = Math.max(aiCheckoutsStarted * 2, aiOrders * 3);
  
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
        conversionRate: 1,
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
    estimatedVisits,
    estimatedCarts,
    totalCheckoutsStarted,
    totalCheckoutsCompleted,
    totalOrders,
    totalOrderGMV,
  );
  
  const aiChannels = buildFunnelStages(
    estimatedAiVisits,
    estimatedAiCarts,
    aiCheckoutsStarted,
    aiCheckoutsCompleted,
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
    const channelCheckoutsStarted = Math.round(channelOrders / 0.7);
    const channelCheckoutsCompleted = channelOrders;
    
    const channelVisits = Math.max(channelCheckoutsStarted * 10, channelOrders * 20);
    const channelCarts = Math.max(channelCheckoutsStarted * 2, channelOrders * 3);
    
    byChannel[channel] = buildFunnelStages(
      channelVisits,
      channelCarts,
      channelCheckoutsStarted,
      channelCheckoutsCompleted,
      channelOrders,
      channelGMV,
    );
  }
  
  // 计算转化率
  const conversionRates = {
    visitToCart: estimatedVisits > 0 ? estimatedCarts / estimatedVisits : 0,
    cartToCheckout: estimatedCarts > 0 ? totalCheckoutsStarted / estimatedCarts : 0,
    checkoutToOrder: totalCheckoutsStarted > 0 ? totalOrders / totalCheckoutsStarted : 0,
    visitToOrder: estimatedVisits > 0 ? totalOrders / estimatedVisits : 0,
    
    aiVisitToCart: estimatedAiVisits > 0 ? estimatedAiCarts / estimatedAiVisits : 0,
    aiCartToCheckout: estimatedAiCarts > 0 ? aiCheckoutsStarted / estimatedAiCarts : 0,
    aiCheckoutToOrder: aiCheckoutsStarted > 0 ? aiOrders / aiCheckoutsStarted : 0,
    aiVisitToOrder: estimatedAiVisits > 0 ? aiOrders / estimatedAiVisits : 0,
  };
  
  // 放弃率
  const abandonment = {
    cartAbandonment: estimatedCarts > 0 ? 1 - totalCheckoutsStarted / estimatedCarts : 0,
    checkoutAbandonment: totalCheckoutsStarted > 0 ? 1 - totalOrders / totalCheckoutsStarted : 0,
    totalAbandonment: estimatedVisits > 0 ? 1 - totalOrders / estimatedVisits : 0,
    
    aiCartAbandonment: estimatedAiCarts > 0 ? 1 - aiCheckoutsStarted / estimatedAiCarts : 0,
    aiCheckoutAbandonment: aiCheckoutsStarted > 0 ? 1 - aiOrders / aiCheckoutsStarted : 0,
  };
  
  // 趋势数据（按天聚合）
  const trend = buildTrendData(orders, range);
  
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
  range: { start: Date; end: Date },
): FunnelData["trend"] {
  const dayMap = new Map<string, {
    visits: number;
    carts: number;
    checkouts: number;
    orders: number;
    aiVisits: number;
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
      aiOrders: 0,
    });
    current.setDate(current.getDate() + 1);
  }
  
  // 聚合订单数据并估算其他阶段
  for (const order of orders) {
    const dateKey = order.createdAt.toISOString().slice(0, 10);
    const day = dayMap.get(dateKey);
    if (day) {
      day.orders += 1;
      // 反推估算
      day.checkouts += Math.round(1 / 0.7); // 约 1.4
      day.carts += Math.round(1 / 0.7 / 0.4); // 约 3.5
      day.visits += Math.round(1 / 0.7 / 0.4 / 0.1); // 约 35
      
      if (order.aiSource) {
        day.aiOrders += 1;
        day.aiVisits += 35;
      }
    }
  }
  
  return Array.from(dayMap.entries())
    .map(([date, data]) => ({ date, ...data }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * 标记放弃的结账（超过24小时未完成）
 * 注意：需要先运行 prisma migrate 创建 Checkout 表
 */
export async function markAbandonedCheckouts(
  shopDomain: string,
  hoursThreshold: number = 24,
): Promise<number> {
  // TODO: 在运行 prisma migrate 后启用
  logger.info("[funnel] markAbandonedCheckouts called (pending migration)", { shopDomain, hoursThreshold });
  return 0;
}
