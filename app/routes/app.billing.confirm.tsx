import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate, BILLING_PLAN } from "../shopify.server";
import { computeIsTestMode, markSubscriptionCheck, shouldOfferTrial } from "../lib/billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);
  const shopDomain = session?.shop || "";
  const isTest = await computeIsTestMode(shopDomain);
  const check = await billing.check({ plans: [BILLING_PLAN], isTest });
  if (check.hasActivePayment) {
    const trialDays = await shouldOfferTrial(shopDomain);
    const trialStart = trialDays > 0 ? new Date() : null;
    const trialEnd = trialDays > 0 ? new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000) : null;
    await markSubscriptionCheck(shopDomain, "active", trialStart, trialEnd, true);
  } else {
    await markSubscriptionCheck(shopDomain, "inactive", null, null, false);
  }
  throw new Response(null, { status: 302, headers: { Location: "/app" } });
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
