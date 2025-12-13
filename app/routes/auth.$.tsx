
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getSettings } from "../lib/settings.server";
import { resolveDateRange } from "../lib/aiData";
import { startBackfill, processBackfillQueue } from "../lib/backfill.server";
import { BACKFILL_COOLDOWN_MINUTES, MAX_BACKFILL_DURATION_MS, MAX_BACKFILL_ORDERS } from "../lib/constants";
import { ensureWebhooks } from "../lib/webhooks.server";
import { logger } from "../lib/logger.server";
import { getAdminClient } from "../lib/adminClient.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  if (session?.shop) {
    const shopDomain = session.shop;

    // 1. 注册 Webhooks（即使失败也继续）
    try {
      await ensureWebhooks(session as any);
    } catch (error) {
      // Webhook 注册失败不应该阻止用户使用应用
      logger.error("[auth] Webhook registration failed", { shopDomain }, { 
        error: (error as Error).message 
      });
    }
    
    // 2. 触发 Backfill（如果需要）
    try {
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
              // 使用备用方案获取 admin client
              const resolvedAdmin = await getAdminClient(
                shopDomain,
                async () => unauthenticated.admin(shopDomain)
              );
              
              if (!resolvedAdmin) {
                logger.warn("[auth] Could not resolve admin client for backfill", { shopDomain });
              }
              return { admin: resolvedAdmin, settings };
            },
            { shopDomain },
          );
        }
      }
    } catch (error) {
      logger.error("[auth] Backfill trigger failed", { shopDomain }, { 
        error: (error as Error).message 
      });
    }

    // 3. 重定向到 onboarding
    const url = new URL(request.url);
    const next = new URL("/app/onboarding", url.origin);
    next.search = url.search;
    throw new Response(null, { status: 302, headers: { Location: next.toString() } });
  }

  return null;
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
