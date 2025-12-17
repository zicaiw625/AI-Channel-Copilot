import type { ActionFunctionArgs } from "react-router";

import { resolveDateRange, type TimeRangeKey } from "../lib/aiData";
import { cleanupStaleJobsForShop, describeBackfill, processBackfillQueue, startBackfill } from "../lib/backfill.server";
import { getSettings } from "../lib/settings.server";
import { authenticate, unauthenticated } from "../shopify.server";
import { DEFAULT_RANGE_KEY, MAX_BACKFILL_DURATION_MS, MAX_BACKFILL_ORDERS } from "../lib/constants";
import { isDemoMode } from "../lib/runtime.server";
import { enforceRateLimit, RateLimitRules } from "../lib/security/rateLimit.server";
import { logger } from "../lib/logger.server";
import { extractAdminClient } from "../lib/graphqlSdk.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST")
    return Response.json({ ok: false, message: "Method not allowed" }, { status: 405 });

  let _admin = null; // admin client from original request (may become invalid in async context)
  let session = null;
  try {
    const auth = await authenticate.admin(request);
    _admin = auth.admin;
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

  // 【修复】先清理卡住的任务，确保用户可以重新触发
  await cleanupStaleJobsForShop(shopDomain);

  const existing = await describeBackfill(shopDomain);
  
  // 如果有已存在的 queued 作业，直接处理它
  if (existing && existing.status === "queued") {
    logger.info("[api.backfill] processing existing queued job", { shopDomain, jobId: existing.id });
    processBackfillQueue(
      async () => {
        let resolvedAdmin = null;
        try {
          const unauthResult = await unauthenticated.admin(shopDomain);
          resolvedAdmin = extractAdminClient(unauthResult);
        } catch (err) {
          logger.warn("[api.backfill] unauthenticated.admin failed", { shopDomain, error: (err as Error).message });
        }
        return { admin: resolvedAdmin, settings };
      },
      { shopDomain },
    ).catch((err) => {
      logger.error("[api.backfill] processBackfillQueue failed for existing job", { shopDomain, error: (err as Error).message });
    });
    return Response.json({
      ok: true,
      queued: true,
      reason: "processing-existing",
      startedAt: existing.startedAt,
      range: existing.range,
    });
  }
  
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

  processBackfillQueue(
    async () => {
      // 在异步回调中重新获取 admin 客户端，因为原始请求上下文可能已失效
      let resolvedAdmin = null;
      try {
        const unauthResult = await unauthenticated.admin(shopDomain);
        logger.info("[api.backfill] unauthenticated.admin resolved", { 
          shopDomain, 
          hasResult: Boolean(unauthResult),
          resultType: typeof unauthResult,
          resultKeys: unauthResult ? Object.keys(unauthResult as object) : [],
        });
        
        // 使用统一的类型安全辅助函数提取 admin 客户端
        resolvedAdmin = extractAdminClient(unauthResult);
      } catch (err) {
        logger.warn("[api.backfill] unauthenticated.admin failed", { shopDomain, error: (err as Error).message });
      }

      logger.info("[api.backfill] backfill dependencies resolved", { 
        shopDomain, 
        hasAdmin: Boolean(resolvedAdmin), 
        hasSettings: Boolean(settings),
      });
      return { admin: resolvedAdmin, settings };
    },
    { shopDomain },
  ).catch((err) => {
    logger.error("[api.backfill] processBackfillQueue failed", { shopDomain, error: (err as Error).message });
  });

  return Response.json({
    ok: true,
    queued: result.queued,
    reason: result.queued ? undefined : result.reason,
    range: dateRange.label,
  });
};
