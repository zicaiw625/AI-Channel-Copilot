/**
 * AI Queries Helper Functions
 * 提取自 aiQueries.server.ts 的通用工具函数
 */

import { Prisma } from "@prisma/client";

// ============================================================================
// Constants
// ============================================================================

/**
 * 【修复】sourceName 过滤条件
 * 
 * 问题：`sourceName: { notIn: ['pos', 'draft'] }` 会把 NULL 值也过滤掉
 * 因为在 SQL 中 `NULL NOT IN (...)` 的结果是 UNKNOWN，会被视为 false
 * 
 * 解决：使用 OR 条件，允许 NULL 值或非 POS/Draft 值通过
 */
export const SOURCE_NAME_FILTER: Prisma.OrderWhereInput = {
  OR: [
    { sourceName: null },
    { sourceName: { notIn: ["pos", "draft"] } },
  ],
};

/**
 * AI 渠道颜色配置
 */
export const CHANNEL_COLORS: Record<string, string> = {
  ChatGPT: "#635bff",
  Perplexity: "#00a2ff",
  Gemini: "#4285f4",
  Copilot: "#0078d4",
  "Other-AI": "#6c6f78",
};

// ============================================================================
// Type Helpers
// ============================================================================

/**
 * 定义聚合结果的类型
 */
export type OrderAggregateResult = {
  _sum: {
    totalPrice: unknown;
    subtotalPrice: unknown;
    refundTotal: unknown;
  };
  _count: {
    _all: number;
  };
};

// ============================================================================
// Number Conversion
// ============================================================================

/**
 * 安全地将各种类型转换为数字
 * 支持 Prisma Decimal、字符串、数字等
 */
export const toNumber = (value: unknown): number => {
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

/**
 * 辅助函数：从聚合结果中获取总值（类型安全版本）
 */
export const getSum = (agg: OrderAggregateResult, metric: string): number => {
  if (metric === "subtotal_price") {
    return toNumber(agg._sum.subtotalPrice);
  }
  return toNumber(agg._sum.totalPrice); // Default to current_total_price
};

/**
 * 四舍五入到小数点后 2 位
 */
export const roundMoney = (value: number): number => Math.round(value * 100) / 100;

// ============================================================================
// Repeat Rate Calculation
// ============================================================================

/**
 * 计算复购率
 * @param orderCountMap - 客户订单数量 Map (customerId -> orderCount)
 * @returns 复购率 (0-1)
 */
export const computeRepeatRate = (orderCountMap: Map<string, number>): number => {
  if (orderCountMap.size === 0) return 0;
  const repeatCustomers = Array.from(orderCountMap.values()).filter(count => count > 1).length;
  return repeatCustomers / orderCountMap.size;
};
