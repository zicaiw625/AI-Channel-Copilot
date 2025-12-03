import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getSettings } from "../lib/settings.server";
import { resolveDateRange, type TimeRangeKey } from "../lib/aiData";
import { loadOrdersFromDb } from "../lib/orderService.server";
import { computeLTV } from "../lib/metrics";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  let session;
  try {
    const auth = await authenticate.admin(request);
    session = auth.session;
  } catch (error) {
    if (process.env.DEMO_MODE !== "true") throw error;
  }

  const shopDomain = session?.shop || "";
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
      controller.enqueue(encoder.encode(`# 客户级 LTV（选定时间范围内累计 GMV）；GMV 口径=${metric}\n`));
      const header = ["customer_id","ltv","gmv_metric","first_ai_acquired","repeat_count","ai_order_share","first_order_at"];
      controller.enqueue(encoder.encode(header.join(",") + "\n"));
      const toCsv = (v: string | number | null | undefined) => {
        const s = v === null || v === undefined ? "" : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const ltvMap = computeLTV(orders, metric);
      const counts = orders.reduce<Record<string, number>>((acc, o) => {
        if (!o.customerId) return acc;
        acc[o.customerId] = (acc[o.customerId] || 0) + 1;
        return acc;
      }, {});
      const fallbackFirstAi: Record<string, boolean> = {};
      orders.forEach((o) => {
        if (!o.customerId) return;
        const cid = o.customerId;
        const prev = fallbackFirstAi[cid];
        if (prev !== true) {
          fallbackFirstAi[cid] = Boolean(o.isNewCustomer && o.aiSource);
        }
      });
      for (const [customerId, ltv] of ltvMap.entries()) {
        const firstAi = Boolean(fallbackFirstAi[customerId]);
        const total = counts[customerId] || 0;
        const aiCount = orders.filter((o) => o.customerId === customerId && Boolean(o.aiSource)).length;
        const aiShare = total ? aiCount / total : 0;
        const firstOrderDate = orders.filter((o) => o.customerId === customerId).map((o) => new Date(o.createdAt)).sort((a, b) => a.getTime() - b.getTime())[0];
        const repeat = Math.max(0, total - 1);
        const row = [
          customerId,
          String(ltv),
          metric,
          firstAi ? "true" : "false",
          String(repeat),
          aiShare.toFixed(4),
          firstOrderDate ? new Date(firstOrderDate).toISOString() : "",
        ].map(toCsv).join(",") + "\n";
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
