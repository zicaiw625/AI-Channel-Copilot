import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import { getSettings } from "../lib/settings.server";
import { requireEnv } from "../lib/env.server";
import { useUILanguage } from "../lib/useUILanguage";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  let language = "中文";
  const url = new URL(request.url);
  const langParam = url.searchParams.get("lang");
  if (langParam === "en") language = "English";

  let shopDomain = url.searchParams.get("shop") || "";

  try {
    const auth = await authenticate.admin(request);
    shopDomain = auth.session?.shop || shopDomain;
  } catch {}

  if (!shopDomain) {
    const token = url.searchParams.get("id_token") || "";
    try {
      const parts = token.split(".");
      const payload = parts.length > 1 ? parts[1] : "";
      const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
      const json = Buffer.from(base64, "base64").toString("utf8");
      const obj = JSON.parse(json) as { dest?: string };
      const dest = obj.dest || "";
      if (dest) {
        const destUrl = new URL(dest);
        const match = destUrl.pathname.match(/\/(?:store)\/([a-zA-Z0-9-_.]+)/);
        if (match && match[1]) {
          shopDomain = `${match[1]}.myshopify.com`;
        }
      }
    } catch {}
  }

  if (!shopDomain) {
    const hostParam = url.searchParams.get("host") || "";
    try {
      const decoded = Buffer.from(hostParam, "base64").toString("utf8");
      const match = decoded.match(/\/store\/([a-zA-Z0-9-_.]+)/);
      if (match && match[1]) {
        const handle = match[1];
        shopDomain = `${handle}.myshopify.com`;
      }
    } catch {}
  }

  if (shopDomain) {
    try {
      const settings = await getSettings(shopDomain);
      language = settings.languages[0] || language;
    } catch {}
  }

  return { language, apiKey: requireEnv("SHOPIFY_API_KEY") };
};

export default function Intro() {
  const { language, apiKey } = useLoaderData<typeof loader>();
  const uiLanguage = useUILanguage(language);
  const en = uiLanguage === "English";
  return (
    <AppProvider embedded apiKey={apiKey}>
      <section style={{ padding: 16 }}>
        <h2>{en ? "AI Channel Copilot Introduction" : "AI Channel Copilot 简介"}</h2>
        <p>{en ? "Detect AI-attributed orders and analyze AOV/LTV." : "识别 AI 渠道订单，分析 AOV/LTV。"}</p>
        <p>{en ? "Permissions: read-only orders/customers; no modifications." : "权限：仅读取订单/客户信息，不会修改订单。"}</p>
        <p>{en ? "Historical sync may be started to populate dashboards." : "可进行历史订单同步以填充仪表盘。"}</p>
        <div style={{ display: "inline-block", marginTop: 12 }}>
          <s-link href="/app/onboarding">
            {en ? "Back to Onboarding" : "返回 Onboarding"}
          </s-link>
        </div>
      </section>
    </AppProvider>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
