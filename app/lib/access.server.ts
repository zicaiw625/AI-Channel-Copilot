import { getBillingState, setSubscriptionExpiredState } from "./billing.server";
import { logger } from "./logger.server";
import { withAdvisoryLock } from "./locks.server";

export type PlanTier = "free" | "pro" | "growth" | "none";

export const FEATURES = {
  DASHBOARD_BASIC: "dashboard_basic", // 7 days, no LTV
  DASHBOARD_FULL: "dashboard_full",   // Full history, LTV, etc.
  COPILOT: "copilot",
  EXPORTS: "exports",
  MULTI_STORE: "multi_store", // Growth only
};

// FNV-1a hash for generating lock keys from shop domain
const hashShopDomain = (shopDomain: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < shopDomain.length; i++) {
    hash ^= shopDomain.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  // Use a specific offset to avoid conflicts with other lock types
  return (hash >>> 0) + 0x50000000; // 0x50000000 = "plan" offset
};

/**
 * 使用 advisory lock 安全地更新过期试用状态
 * 避免多个并发请求同时更新
 */
const updateExpiredTrialState = async (
  shopDomain: string,
  billingPlan: string,
  trialEndAt: Date
): Promise<void> => {
  const lockKey = hashShopDomain(shopDomain);
  
  const { lockInfo } = await withAdvisoryLock(
    lockKey,
    async () => {
      // 在锁内再次检查状态，避免重复更新
      const currentState = await getBillingState(shopDomain);
      if (!currentState?.billingState?.includes("TRIALING")) {
        // 状态已被其他请求更新
        logger.debug("[access] Trial state already updated by another request", { shopDomain });
        return;
      }
      
      logger.info("[access] Trial expired, updating billing state", { 
        shopDomain, 
        billingPlan,
        trialEndAt: trialEndAt.toISOString(),
      });
      
      await setSubscriptionExpiredState(
        shopDomain, 
        billingPlan as "pro" | "growth" | "free", 
        "TRIAL_EXPIRED"
      );
    },
    { fallbackOnError: false }
  );
  
  if (!lockInfo.acquired) {
    // 锁被其他请求持有，说明正在更新中，无需重复操作
    logger.debug("[access] Skipped trial expiry update (lock held)", { shopDomain });
  }
};

export async function getEffectivePlan(shopDomain: string): Promise<PlanTier> {
  const state = await getBillingState(shopDomain);
  if (!state) return "none";

  const { billingState, billingPlan } = state;

  // 开发店不再自动获得 Pro 权限，需要正常订阅流程
  
  // If explicitly cancelled or expired
  if (billingState === "CANCELLED" || billingState === "EXPIRED_NO_SUBSCRIPTION") {
    return "none";
  }
  
  // Check if trialing - verify trial hasn't expired
  if (billingState.includes("TRIALING")) {
    // If lastTrialEndAt exists and is in the past, trial has expired
    if (state.lastTrialEndAt && state.lastTrialEndAt.getTime() < Date.now()) {
      // Trial has expired - update the billing state using lock to prevent race conditions
      // Fire and forget - don't block the response on state update
      updateExpiredTrialState(shopDomain, billingPlan, state.lastTrialEndAt).catch((error) => {
        logger.error("[access] Failed to update expired trial state", { 
          shopDomain, 
          error: error instanceof Error ? error.message : String(error),
        });
      });
      
      // Always return "none" immediately for expired trials
      return "none";
    }
    // Trial is still valid
    if (billingPlan === "growth") return "growth";
    if (billingPlan === "pro") return "pro";
    if (billingPlan === "free") return "free";
  }
  
  // If active (not trialing)
  if (billingState.includes("ACTIVE")) {
     if (billingPlan === "growth") return "growth";
     if (billingPlan === "pro") return "pro";
     if (billingPlan === "free") return "free";
  }
  
  // Fallback for NO_PLAN or unknown
  if (billingState === "NO_PLAN") return "none";
  
  // Default to free if state suggests active but plan is weird? No, safer to return none.
  return "none";
}

export async function hasFeature(shopDomain: string, feature: string): Promise<boolean> {
  const plan = await getEffectivePlan(shopDomain);
  
  switch (feature) {
    case FEATURES.DASHBOARD_BASIC:
      return plan !== "none";
      
    case FEATURES.DASHBOARD_FULL:
    case FEATURES.COPILOT:
    case FEATURES.EXPORTS:
      return plan === "pro" || plan === "growth";
      
    case FEATURES.MULTI_STORE:
      return plan === "growth";
      
    default:
      return false;
  }
}

export async function requireFeature(shopDomain: string, feature: string) {
  const allowed = await hasFeature(shopDomain, feature);
  if (!allowed) {
    throw new Response("Upgrade required", { status: 403, statusText: "Forbidden" });
  }
}

