export type MetricKey = "current_total_price" | "subtotal_price";

export const metricOrderValue = (
  order: { totalPrice: number; subtotalPrice?: number },
  metric: MetricKey,
) => (metric === "subtotal_price" ? order.subtotalPrice ?? order.totalPrice : order.totalPrice);

export const sumGMV = <T extends { totalPrice: number; subtotalPrice?: number }>(
  records: T[],
  metric: MetricKey,
) => records.reduce((total, order) => total + metricOrderValue(order, metric), 0);

export const sumNetGMV = <T extends { totalPrice: number; subtotalPrice?: number; refundTotal?: number }>(
  records: T[],
  metric: MetricKey,
) => records.reduce((total, order) => total + Math.max(0, metricOrderValue(order, metric) - (order.refundTotal || 0)), 0);

export const computeAOV = <T extends { totalPrice: number; subtotalPrice?: number }>(
  records: T[],
  metric: MetricKey,
) => {
  const count = records.length;
  const gmv = sumGMV(records, metric);
  return count ? gmv / count : 0;
};

export const computeLTV = <T extends { totalPrice: number; subtotalPrice?: number; customerId: string | null }>(
  records: T[],
  metric: MetricKey,
) => {
  const byCustomer = new Map<string, number>();
  for (const order of records) {
    if (!order.customerId) continue;
    const prev = byCustomer.get(order.customerId) || 0;
    byCustomer.set(order.customerId, prev + metricOrderValue(order, metric));
  }
  return byCustomer;
};

