import { getBillingState, setSubscriptionExpiredState } from "./billing.server";
import { logger } from "./logger.server";

export type PlanTier = "free" | "pro" | "growth" | "none";

export const FEATURES = {
  DASHBOARD_BASIC: "dashboard_basic", // 7 days, no LTV
  DASHBOARD_FULL: "dashboard_full",   // Full history, LTV, etc.
  COPILOT: "copilot",
  EXPORTS: "exports",
  MULTI_STORE: "multi_store", // Growth only
};

export async function getEffectivePlan(shopDomain: string): Promise<PlanTier> {
  const state = await getBillingState(shopDomain);
  if (!state) return "none";

  const { billingState, billingPlan } = state;

  if (state.isDevShop) {
    return "pro";
  }
  
  // If explicitly cancelled or expired
  if (billingState === "CANCELLED" || billingState === "EXPIRED_NO_SUBSCRIPTION") {
    return "none";
  }
  
  // Check if trialing - verify trial hasn't expired
  if (billingState.includes("TRIALING")) {
    // If lastTrialEndAt exists and is in the past, trial has expired
    if (state.lastTrialEndAt && state.lastTrialEndAt.getTime() < Date.now()) {
      // Trial has expired - update the billing state and return none
      // This is a safety net in case the billing webhook didn't update the state
      logger.info("[access] Trial expired, updating billing state", { 
        shopDomain, 
        billingPlan,
        trialEndAt: state.lastTrialEndAt.toISOString(),
      });
      
      // 同步更新状态以避免竞态条件
      // 虽然这会稍微增加响应时间，但确保后续请求不会获得过期的权限
      try {
        await setSubscriptionExpiredState(shopDomain, billingPlan as "pro" | "growth" | "free", "TRIAL_EXPIRED");
      } catch (error) {
        // 状态更新失败时记录错误，但仍然返回 none 以确保安全
        logger.error("[access] Failed to update expired trial state", { 
          shopDomain, 
          error: error instanceof Error ? error.message : String(error),
        });
      }
      
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

