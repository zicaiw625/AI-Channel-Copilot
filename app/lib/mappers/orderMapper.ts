/**
 * 订单数据映射器
 * 统一处理数据库记录和应用层类型之间的转换
 */

import { Prisma, type Order, type OrderProduct, type AiSource } from "@prisma/client";
import type { OrderRecord, OrderLine } from "../aiTypes";
import { fromPrismaAiSource } from "../aiSourceMapper";

/**
 * 将 Prisma Decimal/number/string 统一转换为 number
 * - Decimal：用于金额字段（NUMERIC/DECIMAL）
 * - string：兼容部分 JSON/序列化场景
 */
const toNumber = (value: unknown): number => {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  // Prisma.Decimal (decimal.js) 兼容
  if (value instanceof Prisma.Decimal) {
    return value.toNumber();
  }
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

/**
 * 数据库订单类型（带 products 关系）
 */
export type OrderWithProducts = Order & {
  products: OrderProduct[];
};

/**
 * 数据库订单类型（可选 products 关系）
 */
export type OrderWithOptionalProducts = Order & {
  products?: OrderProduct[];
};

/**
 * 客户状态类型（用于持久化过程中的内存缓存）
 */
export interface CustomerState {
  id: string;
  shopDomain: string;
  platform: string;
  firstOrderAt: Date | null;
  firstOrderId: string | null;
  lastOrderAt: Date | null;
  orderCount: number;
  totalSpent: number;
  acquiredViaAi: boolean;
  firstAiOrderId: string | null;
}

/**
 * 将数据库 OrderProduct 映射到应用层 OrderLine
 */
export const mapProductToOrderLine = (product: OrderProduct): OrderLine => ({
  id: product.productId,
  title: product.title,
  handle: product.handle || "",
  url: product.url || "",
  price: toNumber(product.price),
  currency: product.currency,
  quantity: product.quantity,
});

/**
 * 将数据库 Order 记录映射到应用层 OrderRecord
 * 
 * @param order - 数据库订单记录
 * @param options - 映射选项
 * @returns OrderRecord 应用层订单记录
 */
export const mapOrderToRecord = (
  order: OrderWithOptionalProducts,
  options: {
    includeProducts?: boolean;
    /** 当 subtotalPrice 为 null 时的回退策略 */
    subtotalFallback?: "totalPrice" | "undefined";
  } = {}
): OrderRecord => {
  const { includeProducts = true, subtotalFallback = "totalPrice" } = options;

  // 处理 subtotalPrice 的回退逻辑
  let subtotalPrice: number | undefined;
  if (order.subtotalPrice !== null) {
    subtotalPrice = toNumber(order.subtotalPrice);
  } else if (subtotalFallback === "totalPrice") {
    subtotalPrice = toNumber(order.totalPrice);
  } else {
    subtotalPrice = undefined;
  }

  // 处理 detectionSignals JSON 字段
  const signals = Array.isArray(order.detectionSignals)
    ? (order.detectionSignals as string[])
    : [];

  // 映射产品
  const products: OrderLine[] =
    includeProducts && order.products
      ? order.products.map(mapProductToOrderLine)
      : [];

  return {
    id: order.id,
    name: order.name,
    createdAt: order.createdAt.toISOString(),
    totalPrice: toNumber(order.totalPrice),
    currency: order.currency,
    subtotalPrice,
    refundTotal: toNumber(order.refundTotal),
    aiSource: fromPrismaAiSource(order.aiSource),
    detection: order.detection || "",
    signals,
    referrer: order.referrer || "",
    landingPage: order.landingPage || "",
    utmSource: order.utmSource || undefined,
    utmMedium: order.utmMedium || undefined,
    sourceName: order.sourceName || undefined,
    customerId: order.customerId || null,
    isNewCustomer: order.isNewCustomer,
    tags: [], // 数据库中不存储 tags，始终为空数组
    products,
  };
};

/**
 * 批量映射订单
 */
export const mapOrdersToRecords = (
  orders: OrderWithOptionalProducts[],
  options?: Parameters<typeof mapOrderToRecord>[1]
): OrderRecord[] => {
  return orders.map((order) => mapOrderToRecord(order, options));
};

/**
 * 创建初始客户状态
 */
export const createInitialCustomerState = (
  customerId: string,
  shopDomain: string,
  platform: string,
  firstOrder: { createdAt: Date; id: string; aiSource: AiSource | null }
): CustomerState => ({
  id: customerId,
  shopDomain,
  platform,
  firstOrderAt: firstOrder.createdAt,
  firstOrderId: firstOrder.id,
  lastOrderAt: firstOrder.createdAt,
  orderCount: 0,
  totalSpent: 0,
  acquiredViaAi: Boolean(firstOrder.aiSource),
  firstAiOrderId: firstOrder.aiSource ? firstOrder.id : null,
});

/**
 * 从数据库客户记录创建客户状态
 */
export const mapCustomerToState = (customer: {
  id: string;
  shopDomain: string;
  platform: string;
  firstOrderAt: Date | null;
  firstOrderId: string | null;
  lastOrderAt: Date | null;
  orderCount: number;
  totalSpent: unknown;
  acquiredViaAi: boolean;
  firstAiOrderId: string | null;
}): CustomerState => ({
  id: customer.id,
  shopDomain: customer.shopDomain,
  platform: customer.platform,
  firstOrderAt: customer.firstOrderAt,
  firstOrderId: customer.firstOrderId,
  lastOrderAt: customer.lastOrderAt,
  orderCount: customer.orderCount,
  totalSpent: toNumber(customer.totalSpent),
  acquiredViaAi: customer.acquiredViaAi,
  firstAiOrderId: customer.firstAiOrderId,
});
