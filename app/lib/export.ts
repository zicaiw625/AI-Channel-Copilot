import type { OrderRecord, ProductRow } from "./aiTypes";
import { computeLTV, metricOrderValue } from "./metrics";

const toCsvValue = (value: string | number | null | undefined) => {
  const str = value === null || value === undefined ? "" : String(value);
  // 防止 CSV 注入攻击（以 =, @, +, - 开头的值在 Excel 中可能被解析为公式）
  const startsWithDangerousChar = /^[=@+-]/.test(str);
  const needsQuoting = /[",\n\r]/.test(str);
  
  if (startsWithDangerousChar) {
    // 在危险字符前添加单引号，防止公式执行
    return `"'${str.replace(/"/g, '""')}"`;
  }
  if (needsQuoting) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

export const buildOrdersCsv = (
  ordersInRange: OrderRecord[],
  metric: "current_total_price" | "subtotal_price" = "current_total_price",
) => {
  const comment = `# 仅统计可识别的 AI 流量（依赖 referrer/UTM/标签，结果为保守估计）；GMV 口径=${metric}`;
  const aiOrders = ordersInRange.filter((order) => order.aiSource);
  const header = [
    "order_name",
    "placed_at",
    "ai_channel",
    "gmv",
    "gmv_metric",
    "referrer",
    "landing_page",
    "source_name",
    "utm_source",
    "utm_medium",
    "detection",
    "order_id",
    "customer_id",
    "new_customer",
  ];

  const rows = aiOrders.map((order) => [
    order.name,
    order.createdAt,
    order.aiSource,
    metricOrderValue(order, metric),
    metric,
    order.referrer,
    order.landingPage,
    order.sourceName || "",
    order.utmSource || "",
    order.utmMedium || "",
    order.detection,
    order.id,
    order.customerId,
    order.isNewCustomer ? "true" : "false",
  ]);

  return [comment, header, ...rows]
    .map((cells) => (Array.isArray(cells) ? cells.map(toCsvValue).join(",") : cells))
    .join("\n");
};

export const buildProductsCsv = (products: ProductRow[]) => {
  const comment = `# 仅统计可识别的 AI 流量（依赖 referrer/UTM/标签，结果为保守估计）`;
  const header = [
    "product_title",
    "ai_orders",
    "ai_gmv",
    "ai_share",
    "top_ai_channel",
    "product_url",
    "product_id",
    "handle",
  ];

  const rows = products.map((product) => [
    product.title,
    product.aiOrders,
    product.aiGMV,
    (product.aiShare * 100).toFixed(1) + "%",
    product.topChannel ?? "",
    product.url,
    product.id,
    product.handle,
  ]);

  return [comment, header, ...rows]
    .map((cells) => (Array.isArray(cells) ? cells.map(toCsvValue).join(",") : cells))
    .join("\n");
};

export const buildCustomersCsv = (
  ordersInRange: OrderRecord[],
  metric: "current_total_price" | "subtotal_price" = "current_total_price",
  acquiredViaAiMap?: Record<string, boolean>,
) => {
  const comment = `# 客户级 LTV（选定时间范围内累计 GMV）；GMV 口径=${metric}`;
  const ltvMap = computeLTV(ordersInRange, metric);
  const counts = ordersInRange.reduce<Record<string, number>>((acc, o) => {
    if (!o.customerId) return acc;
    acc[o.customerId] = (acc[o.customerId] || 0) + 1;
    return acc;
  }, {});
  const fallbackFirstAi: Record<string, boolean> = {};
  ordersInRange.forEach((o) => {
    if (!o.customerId) return;
    const cid = o.customerId;
    const prev = fallbackFirstAi[cid];
    if (prev !== true) {
      fallbackFirstAi[cid] = Boolean(o.isNewCustomer && o.aiSource);
    }
  });
  const header = [
    "customer_id",
    "ltv",
    "gmv_metric",
    "first_ai_acquired",
    "repeat_count",
    "ai_order_share",
    "first_order_at",
  ];
  const rows: string[][] = [];
  for (const [customerId, ltv] of ltvMap.entries()) {
    const firstAi = acquiredViaAiMap
      ? Boolean(acquiredViaAiMap[customerId])
      : Boolean(fallbackFirstAi[customerId]);
    const total = counts[customerId] || 0;
    const aiCount = ordersInRange.filter(
      (o) => o.customerId === customerId && Boolean(o.aiSource),
    ).length;
    const aiShare = total ? aiCount / total : 0;
    const firstOrderDate = ordersInRange
      .filter((o) => o.customerId === customerId)
      .map((o) => new Date(o.createdAt))
      .sort((a, b) => a.getTime() - b.getTime())[0];
    const repeat = Math.max(0, total - 1);
    rows.push([
      customerId,
      String(ltv),
      metric,
      firstAi ? "true" : "false",
      String(repeat),
      aiShare.toFixed(4),
      firstOrderDate ? new Date(firstOrderDate).toISOString() : "",
    ]);
  }
  return [comment, header, ...rows]
    .map((cells) => (Array.isArray(cells) ? cells.map(toCsvValue).join(",") : cells))
    .join("\n");
};

