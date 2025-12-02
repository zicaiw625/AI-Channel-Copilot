import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getSettings, syncShopPreferences } from "../lib/settings.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session?.shop || "";
  let settings = await getSettings(shopDomain);
  settings = await syncShopPreferences(admin, shopDomain, settings);
  const language = settings.languages[0] || "中文";
  return { language };
};

export default function Intro() {
  const { language } = useLoaderData<typeof loader>();
  const en = language === "English";
  return (
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
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
