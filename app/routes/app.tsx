import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { useUILanguage } from "../lib/useUILanguage";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import { requireEnv } from "../lib/env.server";
import { getSettings, syncShopPreferences } from "../lib/settings.server";
import { detectAndPersistDevShop, shouldSkipBillingForPath, calculateRemainingTrialDays } from "../lib/billing.server";
import { getEffectivePlan, FEATURES, hasFeature, type PlanTier } from "../lib/access.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const demo = process.env.DEMO_MODE === "true";
  type AuthShape = Awaited<ReturnType<typeof authenticate.admin>>;
  let admin: AuthShape["admin"] | null = null;
  let session: AuthShape["session"] | null = null;
  let authFailed = false;

  try {
    const auth = await authenticate.admin(request);
    admin = auth.admin;
    session = auth.session;
  } catch (e) {
    authFailed = true;
    const url = new URL(request.url);
    const path = url.pathname.toLowerCase();
    const allowUnauth = path.includes("/app/onboarding") || path.includes("/app/billing");
    if (!demo && !allowUnauth) throw e;
  }

  const shopDomain = session?.shop || "";
  let settings = await getSettings(shopDomain);
  
  // Only use admin client if authentication was successful
  if (admin && shopDomain && !authFailed) {
    try {
      settings = await syncShopPreferences(admin, shopDomain, settings);
    } catch (e) {
      // If syncShopPreferences fails, log but continue with default settings
      console.warn("syncShopPreferences failed:", (e as Error).message);
    }
  }

  try {
    const url = new URL(request.url);
    // Only call detectAndPersistDevShop if authentication was successful
    const isDevShop = (admin && shopDomain && !authFailed) 
      ? await detectAndPersistDevShop(admin, shopDomain) 
      : false;
    const skipBilling = shouldSkipBillingForPath(url.pathname, isDevShop);
    const billingEnabled = process.env.ENABLE_BILLING === "true";

    let plan: PlanTier = "none";
    let trialDaysLeft: number | null = null;
    let canViewFullDashboard = false;

    if (!billingEnabled || demo || isDevShop) {
        plan = "pro"; // Treat as Pro for dev/demo
        canViewFullDashboard = true;
    } else if (!skipBilling) {
        plan = await getEffectivePlan(shopDomain);
        canViewFullDashboard = await hasFeature(shopDomain, FEATURES.DASHBOARD_FULL);
        trialDaysLeft = await calculateRemainingTrialDays(shopDomain);

        const path = url.pathname.toLowerCase();
        const isProtected =
            path === "/app" ||
            (path.startsWith("/app/") &&
                !path.includes("/app/onboarding") &&
                !path.includes("/app/billing") &&
                !path.includes("/app/additional"));

        if (isProtected && plan === "none") {
            const next = new URL("/app/onboarding", url.origin);
            next.search = url.search;
            throw new Response(null, { status: 302, headers: { Location: next.toString() } });
        }
    }

    return {
      apiKey: requireEnv("SHOPIFY_API_KEY"),
      language: settings.languages[0] || "中文",
      plan,
      trialDaysLeft,
      isDevShop,
      canViewFullDashboard
    };
  } catch (e) {
    if (e instanceof Response) throw e;
    console.error(e);
    return {
      apiKey: requireEnv("SHOPIFY_API_KEY"),
      language: settings.languages[0] || "中文",
      plan: "none" as PlanTier,
      trialDaysLeft: null,
      isDevShop: false,
      canViewFullDashboard: false
    };
  }
};

export default function App() {
  const { apiKey, language, plan, trialDaysLeft, isDevShop } = useLoaderData<typeof loader>();
  const uiLanguage = useUILanguage(language);

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">{uiLanguage === "English" ? "AI Dashboard" : "AI 仪表盘"}</s-link>
        <s-link href="/app/additional">{uiLanguage === "English" ? "Settings / Rules & Export" : "设置 / 规则 & 导出"}</s-link>
        
        {/* Only show Subscription link if not Free or if we want them to upgrade from Free */}
        <s-link href="/app/billing">{uiLanguage === "English" ? "Subscription" : "订阅管理"}</s-link>
        
        {plan === "free" && (
          <span style={{ marginLeft: 12, color: "#666" }}>
             {uiLanguage === "English" ? "Free Plan" : "免费版"}
          </span>
        )}
        
        {(plan === "pro" || plan === "growth") && trialDaysLeft !== null && trialDaysLeft > 0 && (
          <span style={{ 
            marginLeft: 12, 
            color: trialDaysLeft <= 3 ? "#d4380d" : "#008060",
            fontWeight: trialDaysLeft <= 3 ? "bold" : "normal"
          }}>
            {trialDaysLeft <= 3 
              ? (uiLanguage === "English" 
                  ? `⚠️ Trial ending soon: ${trialDaysLeft} day${trialDaysLeft === 1 ? '' : 's'} left!` 
                  : `⚠️ 试用即将结束：剩余 ${trialDaysLeft} 天！`)
              : (uiLanguage === "English" 
                  ? `Pro Trial: ${trialDaysLeft} days left` 
                  : `Pro 试用：剩余 ${trialDaysLeft} 天`)}
          </span>
        )}
        
        {isDevShop && (
          <span style={{ marginLeft: 12, color: "#555" }}>
            {uiLanguage === "English" ? "Development store" : "开发店环境"}
          </span>
        )}
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
