import type { OrderRecord } from "./aiData";
import type { MetricKey } from "./metrics.server";
import { metricOrderValue } from "./metrics.server";

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
): TopCustomerRow[] => {
  const byCustomer = new Map<string, { ltv: number; orders: number; ai: boolean }>();

  ordersInRange.forEach((order) => {
    if (!order.customerId) return;
    const prev = byCustomer.get(order.customerId) || { ltv: 0, orders: 0, ai: false };
    prev.ltv += metricOrderValue(order, metric);
    prev.orders += 1;
    prev.ai = prev.ai || Boolean(order.aiSource);
    byCustomer.set(order.customerId, prev);
  });

  return Array.from(byCustomer.entries())
    .map(([customerId, v]) => ({ customerId, ltv: v.ltv, orders: v.orders, ai: v.ai }))
    .sort((a, b) => b.ltv - a.ltv)
    .slice(0, topN);
};

