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
  const url = new URL(request.url);
  // 兼容旧的 returnUrl（没带 shop/host）导致 approve 回跳后无法鉴权：
  // 尝试从 Referer 推断 shop，再把它补回 query 里，避免落到 /auth/login(生产环境 404)。
  if (!url.searchParams.get("shop")) {
    const referer = request.headers.get("referer") || request.headers.get("referrer") || "";
    // 常见 referer: https://{shop}.myshopify.com/admin/...
    const match = referer.match(/https?:\/\/([a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com)(?:\/|$)/);
    const inferredShop = match?.[1];
    if (inferredShop) {
      url.searchParams.set("shop", inferredShop);
      throw new Response(null, { status: 302, headers: { Location: url.toString() } });
    }
  }

  const auth = await authenticate.admin(request);
  // 某些 OAuth / 重新鉴权流程会返回 Response（302），需要原样抛出
  if (auth instanceof Response) throw auth;
  const { admin, billing, session } = auth;
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
    
    // Check if currently in trial by checking both trialDays > 0 AND currentPeriodEnd is in the future
    // trialDays represents remaining trial days, not total trial days
    const trialEnd = details?.currentPeriodEnd ?? null;
    const trialDays = details?.trialDays ?? 0;
    const isInTrial = trialDays > 0 && trialEnd && trialEnd.getTime() > Date.now();
    
    if (isInTrial && plan.trialSupported) {
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
