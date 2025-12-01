import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getSettings } from "../lib/settings.server";
import { resolveDateRange, type TimeRangeKey } from "../lib/aiData";
import { getAiDashboardData } from "../lib/aiQueries.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session?.shop || "";
  const url = new URL(request.url);
  const rangeKey = (url.searchParams.get("range") as TimeRangeKey) || "90d";
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const settings = await getSettings(shopDomain);
  const timezone = settings.timezones[0] || "UTC";
  const dateRange = resolveDateRange(rangeKey, new Date(), from, to, timezone);

  const { data } = await getAiDashboardData(shopDomain, dateRange, settings, {
    timezone,
  });

  return new Response(data.exports.productsCsv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename=ai-products-${rangeKey}.csv`,
    },
  });
};
