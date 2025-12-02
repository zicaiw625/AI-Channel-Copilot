import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate, BILLING_PLAN, MONTHLY_PLAN } from "../shopify.server";
import { computeIsTestMode, markSubscriptionCheck, getActiveSubscriptionDetails } from "../lib/billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, billing, session } = await authenticate.admin(request);
  const shopDomain = session?.shop || "";
  const isTest = await computeIsTestMode(shopDomain);
  const check = await billing.check({ plans: [BILLING_PLAN], isTest });
  if (check.hasActivePayment) {
    const details = await getActiveSubscriptionDetails(admin, MONTHLY_PLAN);
    const trialEnd = details?.trialEnd || null;
    await markSubscriptionCheck(shopDomain, "active", null, trialEnd, true);
    const url = new URL(request.url);
    const next = new URL("/app", url.origin);
    next.search = url.search;
    throw new Response(null, { status: 302, headers: { Location: next.toString() } });
  } else {
    await markSubscriptionCheck(shopDomain, "inactive", null, null, false);
    const url = new URL(request.url);
    const next = new URL("/app/onboarding", url.origin);
    const sp = new URLSearchParams(url.search);
    sp.set("reason", "subscription_inactive");
    next.search = sp.toString();
    throw new Response(null, { status: 302, headers: { Location: next.toString() } });
  }
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
