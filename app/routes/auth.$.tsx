
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getSettings } from "../lib/settings.server";
import { resolveDateRange } from "../lib/aiData";
import { startBackfill, processBackfillQueue } from "../lib/backfill.server";
import { MAX_BACKFILL_DURATION_MS, MAX_BACKFILL_ORDERS } from "../lib/constants";
import { ensureWebhooks } from "../lib/webhooks.server";
import { logger } from "../lib/logger.server";
import { extractAdminClient } from "../lib/graphqlSdk.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const result = await authenticate.admin(request);
  // 重要：某些 /auth/* 流程可能返回 Response（而不是抛出），必须直接返回
  if (result instanceof Response) {
    throw result;
  }
  const { admin, session } = result;

  try {
    if (session?.shop) {
      await ensureWebhooks(session as any);

      const shopDomain = session.shop;
      const settings = await getSettings(shopDomain);
      // 🔧 代码简化：仅首次安装时触发 backfill，后续由 scheduler 或用户手动触发
      const lastBackfillAt = settings.lastBackfillAt ? new Date(settings.lastBackfillAt) : null;
      if (admin && !lastBackfillAt) {
        const calculationTimezone = settings.timezones[0] || "UTC";
        const range = resolveDateRange("90d", new Date(), undefined, undefined, calculationTimezone);
        const queued = await startBackfill(shopDomain, range, {
          maxOrders: MAX_BACKFILL_ORDERS,
          maxDurationMs: MAX_BACKFILL_DURATION_MS,
        });
        if (queued.queued) {
          processBackfillQueue(
            async () => {
              // 在异步回调中重新获取 admin 客户端，因为原始请求上下文可能已失效
              let resolvedAdmin = null;
              try {
                const unauthResult = await unauthenticated.admin(shopDomain);
                logger.info("[auth] unauthenticated.admin resolved", { 
                  shopDomain, 
                  hasResult: Boolean(unauthResult),
                  resultType: typeof unauthResult,
                  resultKeys: unauthResult ? Object.keys(unauthResult as object) : [],
                });
                
                // 使用统一的类型安全辅助函数提取 admin 客户端
                resolvedAdmin = extractAdminClient(unauthResult);
              } catch (err) {
                logger.warn("[auth] unauthenticated.admin failed", { shopDomain, error: (err as Error).message });
              }

              logger.info("[auth] backfill dependencies resolved", { 
                shopDomain, 
                hasAdmin: Boolean(resolvedAdmin), 
                hasSettings: Boolean(settings),
              });
              return { admin: resolvedAdmin, settings };
            },
            { shopDomain },
          ).catch((err) => {
            logger.error("[auth] processBackfillQueue failed", { shopDomain, error: (err as Error).message });
          });
        }
      }

      const url = new URL(request.url);
      const next = new URL("/app/onboarding", url.origin);
      next.search = url.search;
      throw new Response(null, { status: 302, headers: { Location: next.toString() } });
    }
  } catch (error) {
    if (error instanceof Response) throw error;
    logger.warn("[auth] loader encountered error", undefined, { message: (error as Error).message });
  }

  return null;
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
