import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate, BILLING_PLAN, MONTHLY_PLAN } from "../shopify.server";
import { computeIsTestMode, upsertBillingState, getActiveSubscriptionDetails } from "../lib/billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, billing, session } = await authenticate.admin(request);
  const shopDomain = session?.shop || "";
  const isTest = await computeIsTestMode(shopDomain);
  
  // Note: billing.check checks if ANY of the plans are active. 
  // Since we only have one Paid plan (BILLING_PLAN), this works.
  const check = await billing.check({ plans: [BILLING_PLAN], isTest });
  
  if (check.hasActivePayment) {
    const details = await getActiveSubscriptionDetails(admin, MONTHLY_PLAN);
    const trialEnd = details?.trialEnd || null;
    const now = new Date();
    
    // Determine state
    let billingState = "PRO_ACTIVE";
    if (trialEnd && trialEnd > now) {
        billingState = "PRO_TRIALING";
    }
    
    await upsertBillingState(shopDomain, {
        billingPlan: "pro",
        billingState: billingState,
        lastSubscriptionStatus: details?.status || "ACTIVE",
        lastTrialEndAt: trialEnd,
        hasEverSubscribed: true,
        lastCheckedAt: new Date()
    });

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
