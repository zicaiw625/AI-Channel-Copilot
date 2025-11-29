import { json } from "react-router";
import type { ActionFunctionArgs } from "react-router";

import { resolveDateRange } from "../lib/aiData";
import { startBackfill, describeBackfill } from "../lib/backfill.server";
import { getSettings } from "../lib/settings.server";
import { authenticate } from "../shopify.server";
import { DEFAULT_RANGE_KEY, MAX_BACKFILL_DURATION_MS, MAX_BACKFILL_ORDERS } from "../lib/constants";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") return json({ ok: false, message: "Method not allowed" }, { status: 405 });

  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session?.shop || "";
  const formData = await request.formData();
  const rangeKey = (formData.get("range") as string | null) || DEFAULT_RANGE_KEY;
  const from = formData.get("from") as string | null;
  const to = formData.get("to") as string | null;

  const settings = await getSettings(shopDomain);
  const timezone = settings.timezones[0] || "UTC";
  const dateRange = resolveDateRange(rangeKey as any, new Date(), from, to, timezone);

  const existing = await describeBackfill(shopDomain);
  if (existing) {
    return json({
      ok: true,
      queued: false,
      reason: "in-flight",
      startedAt: existing.startedAt,
      range: existing.range,
    });
  }

  const result = await startBackfill(admin, shopDomain, dateRange, settings, {
    maxOrders: MAX_BACKFILL_ORDERS,
    maxDurationMs: MAX_BACKFILL_DURATION_MS,
  });

  return json({
    ok: true,
    queued: result.queued,
    reason: result.queued ? undefined : result.reason,
    range: dateRange.label,
  });
};
