
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getSettings } from "../lib/settings.server";
import { resolveDateRange } from "../lib/aiData";
import { startBackfill, processBackfillQueue } from "../lib/backfill.server";
import { BACKFILL_COOLDOWN_MINUTES, MAX_BACKFILL_DURATION_MS, MAX_BACKFILL_ORDERS } from "../lib/constants";
import { ensureWebhooks } from "../lib/webhooks.server";
import { logger } from "../lib/logger.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  try {
    if (session?.shop) {
      await ensureWebhooks(session as any);

      const shopDomain = session.shop;
      const settings = await getSettings(shopDomain);
      const now = new Date();
      const lastBackfillAt = settings.lastBackfillAt ? new Date(settings.lastBackfillAt) : null;
      const withinCooldown =
        lastBackfillAt && now.getTime() - lastBackfillAt.getTime() < BACKFILL_COOLDOWN_MINUTES * 60 * 1000;
      if (admin && !withinCooldown && !lastBackfillAt) {
        const calculationTimezone = settings.timezones[0] || "UTC";
        const range = resolveDateRange("90d", new Date(), undefined, undefined, calculationTimezone);
        const queued = await startBackfill(shopDomain, range, {
          maxOrders: MAX_BACKFILL_ORDERS,
          maxDurationMs: MAX_BACKFILL_DURATION_MS,
        });
        if (queued.queued) {
          void processBackfillQueue(
            async () => {
              // 在异步回调中重新获取 admin 客户端，因为原始请求上下文可能已失效
              let client: unknown = null;
              try {
                client = await unauthenticated.admin(shopDomain);
                logger.info("[auth] unauthenticated.admin resolved", { shopDomain, hasClient: Boolean(client) });
              } catch (err) {
                logger.warn("[auth] unauthenticated.admin failed", { shopDomain, error: (err as Error).message });
                client = null;
              }

              type GraphqlCapableClient = {
                graphql: (query: string, options: { variables?: Record<string, unknown> }) => Promise<Response>;
              };

              const hasGraphql = (candidate: unknown): candidate is GraphqlCapableClient =>
                typeof candidate === "object" && candidate !== null && typeof (candidate as GraphqlCapableClient).graphql === "function";

              const resolvedAdmin = hasGraphql(client) ? client : null;
              logger.info("[auth] backfill dependencies resolved", { shopDomain, hasAdmin: Boolean(resolvedAdmin), hasSettings: Boolean(settings) });
              return { admin: resolvedAdmin, settings };
            },
            { shopDomain },
          );
        }
      }

      const url = new URL(request.url);
      const next = new URL("/app/onboarding", url.origin);
      next.search = url.search;
      throw new Response(null, { status: 302, headers: { Location: next.toString() } });
    }
  } catch (error) {
    logger.warn("[auth] loader encountered error", undefined, { message: (error as Error).message });
  }

  return null;
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
