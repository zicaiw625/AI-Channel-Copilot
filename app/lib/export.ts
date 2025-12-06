import type { OrderRecord, ProductRow } from "./aiTypes";
import { computeLTV, metricOrderValue } from "./metrics";

export const toCsvValue = (value: string | number | null | undefined) => {
  const str = value === null || value === undefined ? "" : String(value);
  
  // 防止 CSV 注入攻击
  // 危险字符包括：=, @, +, -, Tab, 回车等可能触发公式或宏的字符
  // @see https://owasp.org/www-community/attacks/CSV_Injection
  const startsWithDangerousChar = /^[=@+\-\t\r]/.test(str);
  const containsDangerousPattern = /[\t\r]/.test(str); // Tab 和回车可能在中间位置也有风险
  const needsQuoting = /[",\n\r]/.test(str);
  
  if (startsWithDangerousChar || containsDangerousPattern) {
    // 在危险字符前添加单引号，防止公式执行
    // 同时移除可能的 Tab 和回车字符
    const sanitized = str.replace(/[\t\r]/g, ' ');
    return `"'${sanitized.replace(/"/g, '""')}"`;
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
  
  // 性能优化：O(n) 预处理，避免 O(n²) 的重复遍历
  const counts = new Map<string, number>();
  const aiCounts = new Map<string, number>();
  const firstOrderDates = new Map<string, Date>();
  const computedFirstAi = new Map<string, boolean>();
  
  // 单次遍历预处理所有客户数据
  for (const order of ordersInRange) {
    if (!order.customerId) continue;
    const cid = order.customerId;
    const orderDate = new Date(order.createdAt);
    
    // 订单计数
    counts.set(cid, (counts.get(cid) || 0) + 1);
    
    // AI 订单计数
    if (order.aiSource) {
      aiCounts.set(cid, (aiCounts.get(cid) || 0) + 1);
    }
    
    // 首单日期（取最早的）
    const existingDate = firstOrderDates.get(cid);
    if (!existingDate || orderDate < existingDate) {
      firstOrderDates.set(cid, orderDate);
      // 首单是否为 AI 获客（只在更新首单日期时更新此字段）
      computedFirstAi.set(cid, Boolean(order.isNewCustomer && order.aiSource));
    }
  }
  
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
    // 优先使用外部传入的 acquiredViaAiMap（来自数据库的完整历史数据）
    const firstAi = acquiredViaAiMap
      ? Boolean(acquiredViaAiMap[customerId])
      : (computedFirstAi.get(customerId) || false);
    const total = counts.get(customerId) || 0;
    const aiCount = aiCounts.get(customerId) || 0;
    const aiShare = total ? aiCount / total : 0;
    const firstOrderDate = firstOrderDates.get(customerId);
    const repeat = Math.max(0, total - 1);
    rows.push([
      customerId,
      String(ltv),
      metric,
      firstAi ? "true" : "false",
      String(repeat),
      aiShare.toFixed(4),
      firstOrderDate ? firstOrderDate.toISOString() : "",
    ]);
  }
  return [comment, header, ...rows]
    .map((cells) => (Array.isArray(cells) ? cells.map(toCsvValue).join(",") : cells))
    .join("\n");
};

