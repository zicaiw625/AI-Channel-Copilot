import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useLocation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import { getSettings } from "../lib/settings.server";
import { requireEnv } from "../lib/env.server";
import { useUILanguage } from "../lib/useUILanguage";
import { getShopifyContextParams, getPreservedSearchParams } from "../lib/navigation";
import { normalizeLanguageCode, toUILanguage } from "../lib/language";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  let language = "中文";
  const url = new URL(request.url);
  language = toUILanguage(url.searchParams.get("lang"));

  let shopDomain = url.searchParams.get("shop") || "";

  try {
    const auth = await authenticate.admin(request);
    shopDomain = auth.session?.shop || shopDomain;
  } catch (error) {
    // Ignore authentication errors; intro is accessible pre-install.
    void error;
  }

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
    } catch (error) {
      // Best-effort extraction; ignore malformed token payloads.
      void error;
    }
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
    } catch (error) {
      // Ignore invalid host hints and continue with defaults.
      void error;
    }
  }

  if (shopDomain) {
    try {
      const settings = await getSettings(shopDomain);
      language = settings.languages[0] || language;
    } catch (error) {
      // Ignore settings lookup failures; fall back to default language.
      void error;
    }
  }

  return { language, apiKey: requireEnv("SHOPIFY_API_KEY") };
};

export default function Intro() {
  const { language, apiKey } = useLoaderData<typeof loader>();
  const uiLanguage = useUILanguage(language);
  const en = uiLanguage === "English";
  const location = useLocation();
  const onboardingParams = getShopifyContextParams(location.search);
  const currentParams = getPreservedSearchParams(location.search);
  for (const key of ["shop", "id_token", "lang"] as const) {
    const value = currentParams.get(key);
    if (value) {
      onboardingParams.set(key, key === "lang" ? (normalizeLanguageCode(value) || "zh") : value);
    }
  }
  const onboardingHref = `/app/onboarding${onboardingParams.toString() ? `?${onboardingParams.toString()}` : ""}`;
  return (
    <AppProvider embedded apiKey={apiKey}>
      <section style={{ padding: 16 }}>
        <h2>{en ? "AI SEO & Discovery Introduction" : "AI SEO & Discovery 简介"}</h2>
        <p>{en ? "Detect AI-attributed orders and analyze AOV/LTV." : "识别 AI 渠道订单，分析 AOV/LTV。"}</p>
        <p>{en ? "Permissions: orders/customers stay read-only by default; order tags are written only if you enable tag write-back." : "权限：默认仅读取订单/客户信息；只有手动开启标签写回时，才会向订单写入标签。"}</p>
        <p>{en ? "Historical sync may be started to populate dashboards." : "可进行历史订单同步以填充仪表盘。"}</p>
        <div style={{ display: "inline-block", marginTop: 12 }}>
          <s-link href={onboardingHref}>
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
