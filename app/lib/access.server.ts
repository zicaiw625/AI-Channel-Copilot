import { getBillingState } from "./billing.server";

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
  
  // If explicitly cancelled or expired
  if (billingState === "CANCELLED" || billingState === "EXPIRED_NO_SUBSCRIPTION") {
    return "none";
  }
  
  // If active or trialing
  if (billingState.includes("ACTIVE") || billingState.includes("TRIALING")) {
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

