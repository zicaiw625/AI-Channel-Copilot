import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getSettings } from "../lib/settings.server";
import { resolveDateRange, type TimeRangeKey } from "../lib/aiData";
import { getAiDashboardData } from "../lib/aiQueries.server";
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
  await enforceRateLimit(`export:products:${shopDomain}`, RateLimitRules.EXPORT);
  
  await requireFeature(shopDomain, FEATURES.EXPORTS);
  const url = new URL(request.url);
  const rangeKey = (url.searchParams.get("range") as TimeRangeKey) || "90d";
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const settings = await getSettings(shopDomain);
  const timezone = settings.timezones[0] || "UTC";
  const dateRange = resolveDateRange(rangeKey, new Date(), from, to, timezone);

  const { data } = await getAiDashboardData(shopDomain, dateRange, settings, { timezone });
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const header = [
        "product_title","ai_orders","ai_gmv","ai_share","top_ai_channel","product_url","product_id","handle",
      ];
      // 添加 UTF-8 BOM 以确保 Excel 正确识别中文
      controller.enqueue(new Uint8Array([0xEF, 0xBB, 0xBF]));
      controller.enqueue(encoder.encode(`# 仅统计可识别的 AI 流量（依赖 referrer/UTM/标签，结果为保守估计）\n`));
      controller.enqueue(encoder.encode(header.join(",") + "\n"));
      for (const p of data.topProducts) {
        const row = [
          p.title,
          p.aiOrders,
          p.aiGMV,
          (p.aiShare * 100).toFixed(1) + "%",
          p.topChannel ?? "",
          p.url,
          p.id,
          p.handle,
        ].map(toCsvValue).join(",") + "\n";
        controller.enqueue(encoder.encode(row));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename=ai-products-${rangeKey}.csv`,
    },
  });
};
