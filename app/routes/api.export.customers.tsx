import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getSettings } from "../lib/settings.server";
import { resolveDateRange, type TimeRangeKey } from "../lib/aiData";
import { loadOrdersFromDb } from "../lib/orderService.server";
import { computeLTV } from "../lib/metrics";
import { requireFeature, FEATURES } from "../lib/access.server";
import { isDemoMode } from "../lib/runtime.server";
import { enforceRateLimit, RateLimitRules } from "../lib/security/rateLimit.server";
import { toCsvValue } from "../lib/export";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  let session;
  try {
    const auth = await authenticate.admin(request);
    session = auth.session;
  } catch (error) {
    if (!isDemoMode()) throw error;
  }

  const shopDomain = session?.shop || "";
  
  // Rate limiting: 5 requests per 5 minutes per shop
  await enforceRateLimit(`export:customers:${shopDomain}`, RateLimitRules.EXPORT);
  
  await requireFeature(shopDomain, FEATURES.EXPORTS);
  const url = new URL(request.url);
  const rangeKey = (url.searchParams.get("range") as TimeRangeKey) || "90d";
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const settings = await getSettings(shopDomain);
  const timezone = settings.timezones[0] || "UTC";
  const dateRange = resolveDateRange(rangeKey, new Date(), from, to, timezone);

  // Increase limit for exports
  const { orders } = await loadOrdersFromDb(shopDomain, dateRange, { limit: 100000 });
  
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const metric = settings.gmvMetric;
      // 添加 UTF-8 BOM 以确保 Excel 正确识别中文
      controller.enqueue(new Uint8Array([0xEF, 0xBB, 0xBF]));
      controller.enqueue(encoder.encode(`# 客户级 LTV（选定时间范围内累计 GMV）；GMV 口径=${metric}\n`));
      const header = ["customer_id","ltv","gmv_metric","first_ai_acquired","repeat_count","ai_order_share","first_order_at"];
      controller.enqueue(encoder.encode(header.join(",") + "\n"));
      
      const ltvMap = computeLTV(orders, metric);
      
      // 性能优化：O(n) 预处理，避免 O(n²) 的重复遍历
      const counts = new Map<string, number>();
      const aiCounts = new Map<string, number>();
      const firstOrderDates = new Map<string, Date>();
      const firstAiAcquired = new Map<string, boolean>();
      
      // 单次遍历预处理所有客户数据
      for (const order of orders) {
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
          firstAiAcquired.set(cid, Boolean(order.isNewCustomer && order.aiSource));
        }
      }
      
      for (const [customerId, ltv] of ltvMap.entries()) {
        const firstAi = firstAiAcquired.get(customerId) || false;
        const total = counts.get(customerId) || 0;
        const aiCount = aiCounts.get(customerId) || 0;
        const aiShare = total ? aiCount / total : 0;
        const firstOrderDate = firstOrderDates.get(customerId);
        const repeat = Math.max(0, total - 1);
        const row = [
          customerId,
          String(ltv),
          metric,
          firstAi ? "true" : "false",
          String(repeat),
          aiShare.toFixed(4),
          firstOrderDate ? firstOrderDate.toISOString() : "",
        ].map(toCsvValue).join(",") + "\n";
        controller.enqueue(encoder.encode(row));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename=customers-ltv-${rangeKey}.csv`,
    },
  });
};
