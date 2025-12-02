import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { useUILanguage } from "../lib/useUILanguage";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate, BILLING_PLAN } from "../shopify.server";
import { requireEnv } from "../lib/env.server";
import { getSettings, syncShopPreferences } from "../lib/settings.server";
import { detectAndPersistDevShop, shouldSkipBillingForPath, computeIsTestMode, markSubscriptionCheck, getTrialRemainingDays, getBillingState } from "../lib/billing.server";
 

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, billing, session } = await authenticate.admin(request);
  const shopDomain = session?.shop || "";
  let settings = await getSettings(shopDomain);
  settings = await syncShopPreferences(admin, shopDomain, settings);

  try {
    const url = new URL(request.url);
    const isDevShop = await detectAndPersistDevShop(admin, shopDomain);
    const skipBilling = shouldSkipBillingForPath(url.pathname, isDevShop);
    const billingEnabled = process.env.ENABLE_BILLING === "true";
    if (!billingEnabled) {
      return { apiKey: requireEnv("SHOPIFY_API_KEY"), language: settings.languages[0] || "中文", readOnly: false, trialDaysLeft: null, isDevShop };
    }
    let readOnly = false;
    let trialDaysLeft: number | null = null;
    let devBanner = isDevShop;
    if (!skipBilling) {
      const state = await getBillingState(shopDomain);
      const ttlMinutes = Number(process.env.BILLING_CHECK_TTL_MINUTES || "10");
      const fresh = state?.lastCheckedAt && Date.now() - state.lastCheckedAt.getTime() < ttlMinutes * 60 * 1000;
      const cachedActive = state?.lastSubscriptionStatus === "active" || (typeof state?.lastTrialEndAt === "object" && state?.lastTrialEndAt && state.lastTrialEndAt.getTime() > Date.now());
      if (fresh && cachedActive) {
        readOnly = false;
      } else {
        const isTest = await computeIsTestMode(shopDomain);
        const result = await billing.check({ plans: [BILLING_PLAN], isTest });
        readOnly = !result.hasActivePayment;
        await markSubscriptionCheck(shopDomain, result.hasActivePayment ? "active" : "inactive");
      }
      trialDaysLeft = await getTrialRemainingDays(shopDomain);
      const trialActive = typeof trialDaysLeft === "number" && trialDaysLeft > 0;
      if (trialActive) readOnly = false;
      const path = url.pathname.toLowerCase();
      const isProtected = path === "/app" || (path.startsWith("/app/") && !path.includes("/app/onboarding") && !path.includes("/app/billing") && !path.includes("/app/additional"));
      if (isProtected && readOnly && !trialActive) {
        const next = new URL("/app/onboarding", url.origin);
        next.search = url.search;
        throw new Response(null, { status: 302, headers: { Location: next.toString() } });
      }
    }
    return { apiKey: requireEnv("SHOPIFY_API_KEY"), language: settings.languages[0] || "中文", readOnly, trialDaysLeft, isDevShop: devBanner };
  } catch (e) {
    if (e instanceof Response) throw e;
  }
  return { apiKey: requireEnv("SHOPIFY_API_KEY"), language: settings.languages[0] || "中文", readOnly: false, trialDaysLeft: null, isDevShop: false };
};

export default function App() {
  const { apiKey, language, readOnly, trialDaysLeft, isDevShop } = useLoaderData<typeof loader>();
  const uiLanguage = useUILanguage(language);
  const invalidApiKey = !apiKey || apiKey === "placeholder" || apiKey.length < 10;

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">{uiLanguage === "English" ? "AI Dashboard" : "AI 仪表盘"}</s-link>
        <s-link href="/app/additional">{uiLanguage === "English" ? "Settings / Rules & Export" : "设置 / 规则 & 导出"}</s-link>
        <s-link href="/app/billing">{uiLanguage === "English" ? "Subscription" : "订阅与试用"}</s-link>
        {readOnly && (
          <span style={{ marginLeft: 12, color: "#b00" }}>{uiLanguage === "English" ? "Read-only mode (subscribe to unlock)" : "只读模式（订阅以解锁）"}</span>
        )}
        {typeof trialDaysLeft === "number" && trialDaysLeft > 0 && (
          <span style={{ marginLeft: 12, color: "#555" }}>
            {uiLanguage === "English" ? `Trial ${trialDaysLeft} days left` : `试用剩余 ${trialDaysLeft} 天`}
          </span>
        )}
        {isDevShop && (
          <span style={{ marginLeft: 12, color: "#555" }}>
            {uiLanguage === "English" ? "Development store: free testing mode" : "开发店环境：免费测试模式"}
          </span>
        )}
      </s-app-nav>
      {invalidApiKey && (
        <div style={{ padding: 12, margin: 12, border: "1px solid #ffd7c2", background: "#fff2e8", color: "#b25b1a" }}>
          {uiLanguage === "English"
            ? "Environment misconfigured: set SHOPIFY_API_KEY/SHOPIFY_API_SECRET in Render and redeploy."
            : "环境变量未配置：请在 Render 设置 SHOPIFY_API_KEY/SHOPIFY_API_SECRET 并重新部署。"}
        </div>
      )}
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
