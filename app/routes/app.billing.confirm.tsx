import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate, BILLING_PLAN, MONTHLY_PLAN } from "../shopify.server";
import {
  computeIsTestMode,
  getActiveSubscriptionDetails,
  setSubscriptionActiveState,
  setSubscriptionTrialState,
} from "../lib/billing.server";
import { resolvePlanByShopifyName, PRIMARY_BILLABLE_PLAN_ID, getPlanConfig } from "../lib/billing/plans";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, billing, session } = await authenticate.admin(request);
  const shopDomain = session?.shop || "";
  const isTest = await computeIsTestMode(shopDomain);
  
  // Note: billing.check checks if ANY of the plans are active. 
  // Since we only have one Paid plan (BILLING_PLAN), this works.
  const check = await billing.check({ plans: [BILLING_PLAN] as any, isTest });
  
  if (check.hasActivePayment) {
    const details = await getActiveSubscriptionDetails(admin, MONTHLY_PLAN);
    const plan =
      resolvePlanByShopifyName(details?.name || MONTHLY_PLAN) ||
      getPlanConfig(PRIMARY_BILLABLE_PLAN_ID);
    // Check if currently in trial by checking trialDays > 0
    const isInTrial = (details?.trialDays ?? 0) > 0;
    if (isInTrial && plan.trialSupported) {
      // Calculate trial end based on trialDays from currentPeriodEnd
      const trialEnd = details?.currentPeriodEnd ?? null;
      await setSubscriptionTrialState(shopDomain, plan.id, trialEnd, details?.status ?? "ACTIVE");
    } else {
      await setSubscriptionActiveState(shopDomain, plan.id, details?.status ?? "ACTIVE");
    }

    const url = new URL(request.url);
    const next = new URL("/app", url.origin);
    next.search = url.search;
    throw new Response(null, { status: 302, headers: { Location: next.toString() } });
  } else {
    // declined or failed
    const url = new URL(request.url);
    const next = new URL("/app/onboarding", url.origin);
    const sp = new URLSearchParams(url.search);
    sp.set("step", "plan_selection");
    sp.set("reason", "subscription_declined");
    next.search = sp.toString();
    throw new Response(null, { status: 302, headers: { Location: next.toString() } });
  }
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
