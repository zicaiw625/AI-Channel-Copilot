import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { useEffect, useState } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import { requireEnv } from "../lib/env.server";
import { getSettings, syncShopPreferences } from "../lib/settings.server";
import { ensureBilling } from "../lib/billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session?.shop || "";
  let settings = await getSettings(shopDomain);
  settings = await syncShopPreferences(admin, shopDomain, settings);

  try {
    const url = new URL(request.url);
    const path = url.pathname.toLowerCase();
    const skipBilling = path.includes("/app/billing") || path.includes("/app/additional");
    if (!skipBilling) {
      await ensureBilling(admin as any, shopDomain, request);
    }
  } catch (e) {
    if (e instanceof Response) throw e;
  }

  return { apiKey: requireEnv("SHOPIFY_API_KEY"), language: settings.languages[0] || "中文" };
};

export default function App() {
  const { apiKey, language } = useLoaderData<typeof loader>();
  const [uiLanguage, setUiLanguage] = useState(language);
  useEffect(() => {
    const stored = window.localStorage.getItem("aicc_language");
    if (stored && stored !== uiLanguage) setUiLanguage(stored);
    const onStorage = (e: StorageEvent) => {
      if (e.key === "aicc_language" && typeof e.newValue === "string") {
        setUiLanguage(e.newValue);
      }
    };
    const onCustom = (e: Event) => {
      const ce = e as CustomEvent;
      const detail = typeof ce.detail === "string" ? ce.detail : undefined;
      if (detail && detail !== uiLanguage) setUiLanguage(detail);
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("aicc_language_change", onCustom as EventListener);
    return () => window.removeEventListener("storage", onStorage);
  }, [uiLanguage]);

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
