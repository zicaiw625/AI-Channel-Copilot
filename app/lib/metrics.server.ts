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
/*
  指标口径（统一 helper）
  - GMV：按设置选择订单字段（current_total_price 或 subtotal_price）汇总。
  - 净 GMV：GMV 扣除退款金额（refundTotal）。
  - AOV：GMV / 订单数。
  - LTV：在选定窗口内，按客户累计 GMV（不做预测）。
*/
