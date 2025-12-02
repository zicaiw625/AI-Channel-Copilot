import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { useUILanguage } from "../lib/useUILanguage";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate, BILLING_PLAN } from "../shopify.server";
import { requireEnv, isNonProduction } from "../lib/env.server";
import { LANGUAGE_EVENT, LANGUAGE_STORAGE_KEY } from "../lib/constants";
import { getSettings, syncShopPreferences, getInstallCreatedAt } from "../lib/settings.server";
 

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, billing, session } = await authenticate.admin(request);
  const shopDomain = session?.shop || "";
  let settings = await getSettings(shopDomain);
  settings = await syncShopPreferences(admin, shopDomain, settings);

  try {
    const url = new URL(request.url);
    const skipBilling = shouldSkipBilling(url.pathname);
    if (!skipBilling) {
      const isTest = isNonProduction();
      const enforce = await resolveEnforceBilling(shopDomain);
      if (enforce) {
        await billing.require({
          plans: [BILLING_PLAN as unknown as never],
          isTest,
          onFailure: async () =>
            billing.request({
              plan: BILLING_PLAN as unknown as never,
              isTest,
              returnUrl: `${requireEnv("SHOPIFY_APP_URL")}/app/billing/confirm`,
            }),
        });
      } else {
        await billing.check({ plans: [BILLING_PLAN as unknown as never], isTest });
      }
    }
  } catch (e) {
    if (e instanceof Response) throw e;
  }

  return { apiKey: requireEnv("SHOPIFY_API_KEY"), language: settings.languages[0] || "中文" };
};

export default function App() {
  const { apiKey, language } = useLoaderData<typeof loader>();
  const uiLanguage = useUILanguage(language);

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">{uiLanguage === "English" ? "AI Dashboard" : "AI 仪表盘"}</s-link>
        <s-link href="/app/additional">{uiLanguage === "English" ? "Settings / Rules & Export" : "设置 / 规则 & 导出"}</s-link>
        <s-link href="/app/billing">{uiLanguage === "English" ? "Subscription" : "订阅与试用"}</s-link>
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

const shouldSkipBilling = (pathname: string) => {
  if (process.env.ENABLE_BILLING !== "true") return true;
  const path = pathname.toLowerCase();
  return path.includes("/app/billing") || path.includes("/app/additional");
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
