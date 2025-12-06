import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import { getSettings } from "../lib/settings.server";
import {
  ensureRetentionOncePerDay,
  pruneHistoricalData,
  resolveRetentionMonths,
} from "../lib/retention.server";
import { enforceRateLimit, RateLimitRules } from "../lib/security/rateLimit.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session?.shop || "";
  if (!shopDomain) {
    return Response.json({ ok: false, message: "unauthorized" }, { status: 401 });
  }
  
  // Rate limiting: 10 requests per minute per shop (strict limit for retention operations)
  await enforceRateLimit(`retention:${shopDomain}`, RateLimitRules.STRICT);

  const settings = await getSettings(shopDomain);
  const retentionMonths = resolveRetentionMonths(settings);
  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "true";

  const result = force
    ? await pruneHistoricalData(shopDomain, retentionMonths)
    : await ensureRetentionOncePerDay(shopDomain, settings);

  return Response.json({ ok: true, retentionMonths, ...result });
};
