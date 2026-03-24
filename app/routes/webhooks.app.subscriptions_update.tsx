import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  setSubscriptionTrialState,
  setSubscriptionActiveState,
  setSubscriptionExpiredState,
  getBillingState,
  toPlanId,
} from "../lib/billing.server";
import { resolvePlanByShopifyName, getPlanConfig, PRIMARY_BILLABLE_PLAN_ID } from "../lib/billing/plans";
import { isTrialEndInFuture, resolveAppSubscriptionTrialEnd } from "../lib/billing/trialEnd.server";
import { logger } from "../lib/logger.server";
import prisma from "../db.server";

const PROCESSING_STALE_MS = 5 * 60 * 1000;

type AppSubscriptionPayload = {
  app_subscription?: {
    admin_graphql_api_id?: string | null;
    name?: string | null;
    status?: string | null;
    trial_end?: string | null;
  };
};

type ProcessingState =
  | { skip: true }
  | { skip: false; jobId: number | null };

/**
 * 检查订阅更新 webhook 是否已处理（幂等性检查）
 * 使用订阅 ID + 状态作为幂等键
 * 
 * 🔒 安全说明：
 * - payload 只存储 { subscriptionId, status }，不包含 PII
 * - subscriptionId 是 Shopify 内部 ID (gid://shopify/AppSubscription/xxx)
 * - 这些记录会被 retention.server.ts 的 WebhookJob 清理逻辑定期删除（7 天 TTL）
 */
const beginProcessing = async (
  shopDomain: string,
  subscriptionId: string,
  status: string
): Promise<ProcessingState> => {
  const externalId = `${subscriptionId}:${status}`;
  const topic = "app/subscriptions_update";
  const now = new Date();
  
  try {
    const job = await prisma.webhookJob.create({
      data: {
        shopDomain,
        topic,
        intent: "subscription_status_change",
        externalId,
        payload: { subscriptionId, status },
        status: "processing",
        startedAt: now,
      },
      select: { id: true },
    });
    return { skip: false, jobId: job.id };
  } catch (error) {
    if ((error as { code?: string })?.code === "P2002") {
      const existing = await prisma.webhookJob.findFirst({
        where: { shopDomain, topic, externalId },
        select: { id: true, status: true, createdAt: true, startedAt: true },
      });

      const staleAt = now.getTime() - PROCESSING_STALE_MS;
      const lastStartedAt = existing?.startedAt?.getTime() ?? existing?.createdAt?.getTime() ?? 0;
      const shouldReclaim =
        existing?.status === "failed" ||
        (existing?.status === "processing" && lastStartedAt < staleAt);

      if (existing && shouldReclaim) {
        const staleDate = new Date(staleAt);
        const reclaimed = await prisma.webhookJob.updateMany({
          where: {
            id: existing.id,
            ...(existing.status === "failed"
              ? { status: "failed" as const }
              : {
                  status: "processing" as const,
                  OR: [
                    { startedAt: { lt: staleDate } },
                    {
                      startedAt: null,
                      createdAt: { lt: staleDate },
                    },
                  ],
                }),
          },
          data: {
            status: "processing",
            startedAt: now,
            error: null,
            finishedAt: null,
          },
        });

        if (reclaimed.count > 0) {
          logger.warn("[billing-webhook] Reclaimed stale subscription update", {
            shopDomain,
            subscriptionId,
            status,
            previousStatus: existing.status,
          });
          return { skip: false, jobId: existing.id };
        }
      }

      logger.debug("[billing-webhook] Duplicate subscription update, skipping", {
        shopDomain,
        subscriptionId,
        status,
      });
      return { skip: true };
    }

    logger.warn("[billing-webhook] Idempotency check failed, proceeding", {
      shopDomain,
      error: (error as Error).message,
    });
    return { skip: false, jobId: null };
  }
};

const completeProcessing = async (jobId: number | null) => {
  if (!jobId) return;

  await prisma.webhookJob.updateMany({
    where: { id: jobId },
    data: {
      status: "completed",
      finishedAt: new Date(),
      error: null,
    },
  });
};

const failProcessing = async (jobId: number | null, error: unknown) => {
  if (!jobId) return;

  await prisma.webhookJob.updateMany({
    where: { id: jobId },
    data: {
      status: "failed",
      finishedAt: new Date(),
      error: error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000),
    },
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);
  const shopDomain = shop || "";
  const data = (payload || {}) as AppSubscriptionPayload;
  const subscription = data.app_subscription;
  if (!shopDomain || !subscription) {
    // 不可恢复：返回 200 避免 Shopify 重试风暴
    return new Response();
  }

  const subscriptionId = subscription.admin_graphql_api_id || "";
  const status = (subscription.status || "").toUpperCase();
  
  const processing = subscriptionId
    ? await beginProcessing(shopDomain, subscriptionId, status)
    : { skip: false, jobId: null as number | null };

  if (processing.skip) {
    return new Response();
  }

  const existingState = await getBillingState(shopDomain);
  const fallbackPlanId = toPlanId(existingState?.billingPlan) || PRIMARY_BILLABLE_PLAN_ID;
  const plan =
    resolvePlanByShopifyName(subscription.name) || getPlanConfig(fallbackPlanId);
  const trialEnd = resolveAppSubscriptionTrialEnd({
    trialEndFromShopify: subscription.trial_end ? new Date(subscription.trial_end) : null,
  });

  logger.info("[billing-webhook] Processing subscription update", {
    shopDomain,
    subscriptionId,
    status,
    planId: plan.id,
  });

  try {
    if (status === "ACTIVE") {
      if (isTrialEndInFuture(trialEnd) && plan.trialSupported) {
        await setSubscriptionTrialState(shopDomain, plan.id, trialEnd, status);
      } else if (plan.trialSupported) {
        // 关键修复：如果当前已经处于 TRIALING 状态且试用期未过期，不要覆盖为 ACTIVE
        const isCurrentlyTrialing = existingState?.billingState?.includes("TRIALING") &&
          existingState?.lastTrialEndAt && 
          existingState.lastTrialEndAt.getTime() > Date.now();
        
        if (!isCurrentlyTrialing) {
          await setSubscriptionActiveState(shopDomain, plan.id, status);
        } else {
          logger.debug("[billing-webhook] Keeping existing active trial state", {
            shopDomain,
            subscriptionId,
            status,
          });
        }
      } else {
        await setSubscriptionActiveState(shopDomain, plan.id, status);
      }
    } else if (status === "CANCELLED") {
      await setSubscriptionExpiredState(shopDomain, plan.id, status);
    } else if (status === "EXPIRED") {
      await setSubscriptionExpiredState(shopDomain, plan.id, status);
    }

    await completeProcessing(processing.jobId);
    return new Response();
  } catch (error) {
    await failProcessing(processing.jobId, error);
    throw error;
  }
};

