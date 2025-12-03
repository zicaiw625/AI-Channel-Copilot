 
import type { ActionFunctionArgs } from "react-router";

import { resolveDateRange, type TimeRangeKey } from "../lib/aiData";
import { describeBackfill, processBackfillQueue, startBackfill } from "../lib/backfill.server";
import { getSettings } from "../lib/settings.server";
import { authenticate } from "../shopify.server";
import { DEFAULT_RANGE_KEY, MAX_BACKFILL_DURATION_MS, MAX_BACKFILL_ORDERS } from "../lib/constants";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST")
    return Response.json({ ok: false, message: "Method not allowed" }, { status: 405 });

  let admin = null;
  let session = null;
  try {
    const auth = await authenticate.admin(request);
    admin = auth.admin;
    session = auth.session;
  } catch (error) {
    if (process.env.DEMO_MODE !== "true") throw error;
  }

  const shopDomain = session?.shop || "";
  // In demo mode, if no shop domain, we can't trigger backfill
  if (!shopDomain && process.env.DEMO_MODE === "true") {
    return Response.json({
      ok: false,
      queued: false,
      reason: "Demo mode: cannot trigger backfill without shop session",
    });
  }

  const formData = await request.formData();
  const formRange = formData.get("range");
  const rangeKey: TimeRangeKey =
    formRange === "7d" || formRange === "30d" || formRange === "90d" || formRange === "custom"
      ? formRange
      : DEFAULT_RANGE_KEY;
  const from = formData.get("from") as string | null;
  const to = formData.get("to") as string | null;

  const settings = await getSettings(shopDomain);
  const timezone = settings.timezones[0] || "UTC";
  const dateRange = resolveDateRange(rangeKey, new Date(), from, to, timezone);

  const existing = await describeBackfill(shopDomain);
  if (existing) {
    return Response.json({
      ok: true,
      queued: false,
      reason: "in-flight",
      startedAt: existing.startedAt,
      range: existing.range,
    });
  }

  const result = await startBackfill(shopDomain, dateRange, {
    maxOrders: MAX_BACKFILL_ORDERS,
    maxDurationMs: MAX_BACKFILL_DURATION_MS,
  });

  void processBackfillQueue(
    async () => ({ admin, settings }),
    { shopDomain },
  );

  return Response.json({
    ok: true,
    queued: result.queued,
    reason: result.queued ? undefined : result.reason,
    range: dateRange.label,
  });
};
