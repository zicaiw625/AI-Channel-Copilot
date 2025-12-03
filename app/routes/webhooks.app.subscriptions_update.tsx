import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  setSubscriptionTrialState,
  setSubscriptionActiveState,
  setSubscriptionExpiredState,
  activateFreePlan,
} from "../lib/billing.server";
import { resolvePlanByShopifyName, getPlanConfig, PRIMARY_BILLABLE_PLAN_ID } from "../lib/billing/plans";

type AppSubscriptionPayload = {
  app_subscription?: {
    name?: string | null;
    status?: string | null;
    trial_end?: string | null;
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);
  const shopDomain = shop || "";
  const data = (payload || {}) as AppSubscriptionPayload;
  const subscription = data.app_subscription;
  if (!shopDomain || !subscription) {
    return new Response(undefined, { status: 400 });
  }

  const plan =
    resolvePlanByShopifyName(subscription.name) || getPlanConfig(PRIMARY_BILLABLE_PLAN_ID);
  const status = (subscription.status || "").toUpperCase();
  const trialEnd = subscription.trial_end ? new Date(subscription.trial_end) : null;

  if (status === "ACTIVE") {
    if (trialEnd && trialEnd.getTime() > Date.now() && plan.trialSupported) {
      await setSubscriptionTrialState(shopDomain, plan.id, trialEnd, status);
    } else {
      await setSubscriptionActiveState(shopDomain, plan.id, status);
    }
  } else if (status === "CANCELLED") {
    await setSubscriptionExpiredState(shopDomain, plan.id, status);
    await activateFreePlan(shopDomain);
  } else if (status === "EXPIRED") {
    await setSubscriptionExpiredState(shopDomain, plan.id, status);
  }

  return new Response();
};

