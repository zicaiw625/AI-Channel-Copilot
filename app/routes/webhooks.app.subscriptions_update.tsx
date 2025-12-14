import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  setSubscriptionTrialState,
  setSubscriptionActiveState,
  setSubscriptionExpiredState,
} from "../lib/billing.server";
import { resolvePlanByShopifyName, getPlanConfig, PRIMARY_BILLABLE_PLAN_ID } from "../lib/billing/plans";
import { logger } from "../lib/logger.server";
import prisma from "../db.server";

type AppSubscriptionPayload = {
  app_subscription?: {
    admin_graphql_api_id?: string | null;
    name?: string | null;
    status?: string | null;
    trial_end?: string | null;
  };
};

/**
 * 检查订阅更新 webhook 是否已处理（幂等性检查）
 * 使用订阅 ID + 状态作为幂等键
 */
const checkAndMarkProcessed = async (
  shopDomain: string,
  subscriptionId: string,
  status: string
): Promise<boolean> => {
  // 使用 subscriptionId:status 作为 externalId，确保同一状态变更只处理一次
  const externalId = `${subscriptionId}:${status}`;
  const topic = "app/subscriptions_update";
  
  try {
    // 尝试创建记录，如果已存在则会因唯一约束失败
    await prisma.webhookJob.create({
      data: {
        shopDomain,
        topic,
        intent: "subscription_status_change",
        externalId,
        payload: { subscriptionId, status },
        status: "completed",
        finishedAt: new Date(),
      },
    });
    return false; // 未处理过，继续处理
  } catch (error) {
    // P2002 = unique constraint violation
    if ((error as { code?: string })?.code === "P2002") {
      logger.debug("[billing-webhook] Duplicate subscription update, skipping", {
        shopDomain,
        subscriptionId,
        status,
      });
      return true; // 已处理过，跳过
    }
    // 其他错误继续处理（宁可重复处理也不要丢失）
    logger.warn("[billing-webhook] Idempotency check failed, proceeding", {
      shopDomain,
      error: (error as Error).message,
    });
    return false;
  }
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
  
  // 幂等性检查：如果这个状态变更已处理，直接返回成功
  if (subscriptionId && await checkAndMarkProcessed(shopDomain, subscriptionId, status)) {
    return new Response(); // 200 OK - 已处理
  }

  const plan =
    resolvePlanByShopifyName(subscription.name) || getPlanConfig(PRIMARY_BILLABLE_PLAN_ID);
  const trialEnd = subscription.trial_end ? new Date(subscription.trial_end) : null;

  logger.info("[billing-webhook] Processing subscription update", {
    shopDomain,
    subscriptionId,
    status,
    planId: plan.id,
  });

  if (status === "ACTIVE") {
    if (trialEnd && trialEnd.getTime() > Date.now() && plan.trialSupported) {
      await setSubscriptionTrialState(shopDomain, plan.id, trialEnd, status);
    } else {
      await setSubscriptionActiveState(shopDomain, plan.id, status);
    }
  } else if (status === "CANCELLED") {
    // Set to EXPIRED_NO_SUBSCRIPTION instead of directly activating Free plan
    // This allows the user to choose their next plan (Free or re-subscribe)
    // The access control will redirect them to onboarding to make a choice
    await setSubscriptionExpiredState(shopDomain, plan.id, status);
    // Note: We intentionally do NOT call activateFreePlan here
    // The user will be prompted to choose a plan when they next access the app
  } else if (status === "EXPIRED") {
    await setSubscriptionExpiredState(shopDomain, plan.id, status);
  }

  return new Response();
};

