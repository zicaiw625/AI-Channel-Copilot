import type { ActionFunctionArgs } from "react-router";

import { resolveDateRange, type TimeRangeKey } from "../lib/aiData";
import { describeBackfill, processBackfillQueue, startBackfill } from "../lib/backfill.server";
import { getSettings } from "../lib/settings.server";
import { authenticate, unauthenticated } from "../shopify.server";
import { DEFAULT_RANGE_KEY, MAX_BACKFILL_DURATION_MS, MAX_BACKFILL_ORDERS } from "../lib/constants";
import { isDemoMode } from "../lib/runtime.server";
import { enforceRateLimit, RateLimitRules } from "../lib/security/rateLimit.server";

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
    if (!isDemoMode()) throw error;
  }

  const shopDomain = session?.shop || "";
  
  // Rate limiting: 10 requests per minute per shop (strict limit for backfill operations)
  if (shopDomain) {
    await enforceRateLimit(`backfill:${shopDomain}`, RateLimitRules.STRICT);
  }
  // In demo mode, if no shop domain, we can't trigger backfill
  if (!shopDomain && isDemoMode()) {
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
    async () => {
      // 在异步回调中重新获取 admin 客户端，因为原始请求上下文可能已失效
      let client: unknown = null;
      try {
        client = await unauthenticated.admin(shopDomain);
      } catch {
        client = null;
      }

      type GraphqlCapableClient = {
        graphql: (query: string, options: { variables?: Record<string, unknown> }) => Promise<Response>;
      };

      const hasGraphql = (candidate: unknown): candidate is GraphqlCapableClient =>
        typeof candidate === "object" && candidate !== null && typeof (candidate as GraphqlCapableClient).graphql === "function";

      const resolvedAdmin = hasGraphql(client) ? client : null;
      return { admin: resolvedAdmin, settings };
    },
    { shopDomain },
  );

  return Response.json({
    ok: true,
    queued: result.queued,
    reason: result.queued ? undefined : result.reason,
    range: dateRange.label,
  });
};
