/**
 * 订单数据服务
 * 处理订单数据的查询和管理
 */

import prisma from "../db.server";
import type { DateRange, OrderRecord } from "./aiTypes";
import { DatabaseError, ValidationError } from "./errors";
import { logger } from "./logger.server";
import { fromPrismaAiSource } from "./aiSourceMapper";
import { Prisma } from "@prisma/client";

const toNumber = (value: unknown): number => {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  if (value instanceof Prisma.Decimal) return value.toNumber();
  const maybe = value as { toNumber?: () => number; toString?: () => string };
  if (typeof maybe?.toNumber === "function") {
    const n = maybe.toNumber();
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof maybe?.toString === "function") {
    const n = Number(maybe.toString());
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

export interface OrderQueryOptions {
  limit?: number;
  offset?: number;
  includeProducts?: boolean;
}

/**
 * 从数据库加载订单数据
 * 优化：使用 limit + 1 策略避免额外的 COUNT 查询
 */
export const loadOrdersFromDb = async (
  shopDomain: string,
  dateRange: DateRange,
  options: OrderQueryOptions = {}
): Promise<{ orders: OrderRecord[]; clamped: boolean }> => {
  const { limit = 10000, includeProducts = true } = options;

  try {
    // 优化：获取 limit + 1 条记录来判断是否被截断，避免额外的 COUNT 查询
    const orders = await prisma.order.findMany({
      where: {
        shopDomain,
        createdAt: {
          gte: dateRange.start,
          lte: dateRange.end,
        },
      },
      take: limit + 1,
      orderBy: {
        createdAt: 'desc' as const,
      },
      ...(includeProducts && { include: { products: true } }),
    });

    // 判断是否超过限制
    const clamped = orders.length > limit;
    
    // 如果超过限制，移除多余的一条记录
    if (clamped) {
      orders.pop();
    }

    // 转换数据格式，包括 AI 来源枚举转换
    const orderRecords: OrderRecord[] = orders.map((order) => {
      const orderWithProducts = order as typeof order & { products?: Array<{ productId: string; title: string; handle: string | null; url: string | null; price: number; currency: string; quantity: number }> };
      const totalPrice = toNumber(order.totalPrice);
      const subtotal = order.subtotalPrice !== null && order.subtotalPrice !== undefined ? toNumber(order.subtotalPrice) : totalPrice;
      return {
      id: order.id,
      name: order.name,
      createdAt: order.createdAt.toISOString(),
      totalPrice,
      currency: order.currency,
      subtotalPrice: subtotal,
      refundTotal: toNumber(order.refundTotal),
      aiSource: fromPrismaAiSource(order.aiSource),
      detection: order.detection || "",
      signals: Array.isArray(order.detectionSignals) ? (order.detectionSignals as string[]) : [],
      referrer: order.referrer || "",
      landingPage: order.landingPage || "",
      utmSource: order.utmSource || undefined,
      utmMedium: order.utmMedium || undefined,
      sourceName: order.sourceName || undefined,
      customerId: order.customerId,
      isNewCustomer: order.isNewCustomer,
        products: includeProducts && orderWithProducts.products
          ? orderWithProducts.products.map((p) => ({
            id: p.productId,
            title: p.title,
            handle: p.handle || "",
            url: p.url || "",
            price: toNumber(p.price),
            currency: p.currency,
            quantity: p.quantity,
          }))
        : [],
      };
    });

    logger.info("[order.service] Loaded orders from database", {
      shopDomain,
      dateRange: dateRange.label,
      loadedCount: orderRecords.length,
      clamped,
    });

    return { orders: orderRecords, clamped };
  } catch (error) {
    logger.error("[order.service] Failed to load orders", {
      shopDomain,
      dateRange: dateRange.label,
      limit,
    }, { error: error instanceof Error ? error.message : String(error) });

    throw new DatabaseError("Failed to load orders from database", {
      shopDomain,
      dateRange: dateRange.label,
    });
  }
};

/**
 * 获取订单统计信息
 * 优化：使用 Promise.all 并行执行两个独立查询
 */
export const getOrderStats = async (
  shopDomain: string,
  dateRange: DateRange
) => {
  try {
    const whereClause = {
      shopDomain,
      createdAt: {
        gte: dateRange.start,
        lte: dateRange.end,
      },
    };

    // 并行执行两个独立的数据库查询
    const [stats, totalStats] = await Promise.all([
      prisma.order.groupBy({
        by: ['aiSource'],
        where: whereClause,
        _count: {
          id: true,
        },
        _sum: {
          totalPrice: true,
          refundTotal: true,
        },
      }),
      prisma.order.aggregate({
        where: whereClause,
        _count: {
          id: true,
        },
        _sum: {
          totalPrice: true,
          refundTotal: true,
        },
      }),
    ]);

    return {
      bySource: stats,
      total: totalStats,
    };
  } catch (error) {
    logger.error("[order.service] Failed to get order stats", {
      shopDomain,
      dateRange: dateRange.label,
    }, { error: error instanceof Error ? error.message : String(error) });

    throw new DatabaseError("Failed to get order statistics", {
      shopDomain,
      dateRange: dateRange.label,
    });
  }
};

/**
 * 验证订单数据
 */
export const validateOrderData = (order: Partial<OrderRecord>): void => {
  if (!order.id) {
    throw new ValidationError("Order ID is required");
  }

  if (!order.createdAt) {
    throw new ValidationError("Order createdAt is required");
  }

  if (typeof order.totalPrice !== 'number' || order.totalPrice < 0) {
    throw new ValidationError("Order totalPrice must be a non-negative number");
  }

  if (!order.currency) {
    throw new ValidationError("Order currency is required");
  }
};
