import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import { requireEnv } from "../lib/env.server";
import { getSettings, syncShopPreferences } from "../lib/settings.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session?.shop || "";
  let settings = await getSettings(shopDomain);
  settings = await syncShopPreferences(admin, shopDomain, settings);

  return { apiKey: requireEnv("SHOPIFY_API_KEY"), language: settings.languages[0] || "中文" };
};

export default function App() {
  const { apiKey, language } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">{language === "English" ? "AI Dashboard" : "AI 仪表盘"}</s-link>
        <s-link href="/app/additional">{language === "English" ? "Settings / Rules & Export" : "设置 / 规则 & 导出"}</s-link>
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
