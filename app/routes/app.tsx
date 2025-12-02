import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { useUILanguage } from "../lib/useUILanguage";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate, BILLING_PLAN } from "../shopify.server";
import { requireEnv, isNonProduction } from "../lib/env.server";
import { LANGUAGE_EVENT, LANGUAGE_STORAGE_KEY } from "../lib/constants";
import { getSettings, syncShopPreferences, getInstallCreatedAt } from "../lib/settings.server";
import { detectAndPersistDevShop, shouldSkipBillingForPath, computeIsTestMode, markSubscriptionCheck, getTrialRemainingDays } from "../lib/billing.server";
 

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, billing, session } = await authenticate.admin(request);
  const shopDomain = session?.shop || "";
  let settings = await getSettings(shopDomain);
  settings = await syncShopPreferences(admin, shopDomain, settings);

  try {
    const url = new URL(request.url);
    const isDevShop = await detectAndPersistDevShop(admin, shopDomain);
    const skipBilling = shouldSkipBillingForPath(url.pathname, isDevShop);
    let readOnly = false;
    if (!skipBilling) {
      const isTest = await computeIsTestMode(shopDomain);
      const result = await billing.check({ plans: [BILLING_PLAN as unknown as never], isTest });
      readOnly = !result.hasActivePayment;
      await markSubscriptionCheck(shopDomain, result.hasActivePayment ? "active" : "inactive");
      const path = url.pathname.toLowerCase();
      const isProtected = path === "/app" || (path.startsWith("/app/") && !path.includes("/app/onboarding") && !path.includes("/app/billing") && !path.includes("/app/additional"));
      if (isProtected && readOnly) {
        throw new Response(null, { status: 302, headers: { Location: "/app/onboarding" } });
      }
    }
    const trialDaysLeft = await getTrialRemainingDays(shopDomain);
    return { apiKey: requireEnv("SHOPIFY_API_KEY"), language: settings.languages[0] || "中文", readOnly, trialDaysLeft };
  } catch (e) {
    if (e instanceof Response) throw e;
  }
  return { apiKey: requireEnv("SHOPIFY_API_KEY"), language: settings.languages[0] || "中文", readOnly: false, trialDaysLeft: null };
};

export default function App() {
  const { apiKey, language, readOnly, trialDaysLeft } = useLoaderData<typeof loader>();
  const uiLanguage = useUILanguage(language);

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
      </s-app-nav>
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

const shouldEnforceBilling = () => process.env.BILLING_ENFORCE === "true";
const resolveEnforceBilling = async (shopDomain: string) => {
  if (shouldEnforceBilling()) return true;
  const freeDays = Number(process.env.BILLING_FREE_DAYS || "7");
  const createdAt = await getInstallCreatedAt(shopDomain);
  if (!createdAt) return false;
  const now = Date.now();
  const ageDays = Math.floor((now - createdAt.getTime()) / (24 * 60 * 60 * 1000));
  return ageDays >= Math.max(0, freeDays);
};
