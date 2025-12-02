
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import shopify, { authenticate, BILLING_PLAN, type BillingPlanKey } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getSettings, markActivity } from "../lib/settings.server";
import { detectAndPersistDevShop, computeIsTestMode } from "../lib/billing.server";
import { resolveDateRange } from "../lib/aiData";
import { fetchOrdersForRange } from "../lib/shopifyOrders.server";
import { persistOrders } from "../lib/persistence.server";
import { BACKFILL_COOLDOWN_MINUTES, MAX_BACKFILL_DURATION_MS, MAX_BACKFILL_ORDERS } from "../lib/constants";
import { ensureWebhooks } from "../lib/webhooks.server";
import { logger } from "../lib/logger.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session, billing } = await authenticate.admin(request);

  try {
    if (session?.shop) {
      await ensureWebhooks(session);

      const shopDomain = session.shop;
      const settings = await getSettings(shopDomain);
      const now = new Date();
      const lastBackfillAt = settings.lastBackfillAt ? new Date(settings.lastBackfillAt) : null;
      const withinCooldown =
        lastBackfillAt && now.getTime() - lastBackfillAt.getTime() < BACKFILL_COOLDOWN_MINUTES * 60 * 1000;
      if (admin && !withinCooldown && !lastBackfillAt) {
        const calculationTimezone = settings.timezones[0] || "UTC";
        const range = resolveDateRange("90d", new Date(), undefined, undefined, calculationTimezone);
        const { orders } = await fetchOrdersForRange(
          admin,
          range,
          settings,
          { shopDomain, intent: "auth-initial-backfill", rangeLabel: range.label },
          { maxOrders: MAX_BACKFILL_ORDERS, maxDurationMs: MAX_BACKFILL_DURATION_MS },
        );
        if (orders.length) {
          await persistOrders(shopDomain, orders);
          await markActivity(shopDomain, { lastBackfillAt: new Date() });
        }
      }

      const isDev = await detectAndPersistDevShop(admin, shopDomain);
      const isTest = await computeIsTestMode(shopDomain);
      const check = await billing.check({ plans: [BILLING_PLAN as BillingPlanKey], isTest });
      if (!isDev && !check.hasActivePayment) {
        const url = new URL(request.url);
        const next = new URL("/app/onboarding", url.origin);
        next.search = url.search;
        throw new Response(null, { status: 302, headers: { Location: next.toString() } });
      }
    }
  } catch (error) {
    logger.warn("[auth] loader encountered error", undefined, { message: (error as Error).message });
  }

  return null;
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
