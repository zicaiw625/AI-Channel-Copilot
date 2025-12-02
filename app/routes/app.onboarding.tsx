import type { HeadersFunction, LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate, BILLING_PLAN } from "../shopify.server";
import { requireEnv } from "../lib/env.server";
import { shouldOfferTrial, computeIsTestMode, detectAndPersistDevShop } from "../lib/billing.server";
import { getSettings, syncShopPreferences } from "../lib/settings.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session?.shop || "";
  let settings = await getSettings(shopDomain);
  settings = await syncShopPreferences(admin, shopDomain, settings);
  const trialDays = await shouldOfferTrial(shopDomain);
  const isDevShop = await detectAndPersistDevShop(admin, shopDomain);
  const price = Number(process.env.BILLING_PRICE || "5");
  const currency = process.env.BILLING_CURRENCY || "USD";
  const url = new URL(request.url);
  const reason = url.searchParams.get("reason") || "";
  return { language: settings.languages[0] || "中文", planName: BILLING_PLAN, trialDays, price, currency, isDevShop, reason };
};

export default function Onboarding() {
  const { language, planName, trialDays, price, currency, isDevShop, reason } = useLoaderData<typeof loader>();
  const en = language === "English";
  return (
    <section style={{ padding: 16 }}>
      <h2>{en ? "Welcome to AI Channel Copilot" : "欢迎使用 AI Channel Copilot"}</h2>
      {reason === "subscription_inactive" && (
        <div style={{ marginTop: 8, padding: 10, background: "#fff2e8", border: "1px solid #ffd7c2", color: "#b25b1a" }}>
          {en ? "You haven't completed the subscription yet." : "你尚未完成订阅"}
        </div>
      )}
      <div style={{ marginTop: 12 }}>
        <p>{en ? "Value: detect AI-attributed orders, analyze AOV/LTV, cohorts." : "应用价值：识别 AI 渠道订单，分析 AOV/LTV、留存分群等。"}</p>
        <p>{en ? "Permissions: read orders/customers only; we do not modify orders." : "权限与数据：仅读取订单/客户信息，不会修改订单等数据。"}</p>
        <p>{en ? "We may start historical sync to populate dashboards." : "可启动历史订单同步以填充仪表盘。"}</p>
      </div>
      <div style={{ marginTop: 16, padding: 12, background: "#f7f7f7" }}>
        {!isDevShop && (
          <p>
            {en
              ? `Plan: ${planName}, $${price} / 30 days, ${trialDays} days free trial.`
              : `计划：${planName}，$${price} / 每 30 天，含 ${trialDays} 天免费试用。`}
          </p>
        )}
        {!isDevShop && trialDays >= 0 && (
          <form method="post" action="/app/billing/start" style={{ display: "inline-block", marginRight: 12 }}>
            <button type="submit">
              {en
                ? (trialDays > 0 ? `Start ${trialDays}-day Free Trial` : "Start Subscription")
                : (trialDays > 0 ? `开始 ${trialDays} 天免费试用` : "开始订阅")}
            </button>
          </form>
        )}
        {!isDevShop && (
          <a href="/app" style={{ display: "inline-block", marginTop: 8 }}>
            {en ? "Maybe later, view intro only" : "稍后再说，仅查看介绍"}
          </a>
        )}
        {isDevShop && (
          <div>
            <p>{en ? "Development store detected: app is free for testing." : "检测到开发者商店：本应用在开发者商店环境中永久免费，仅限测试使用。"}</p>
            <a href="/app" style={{ display: "inline-block", marginTop: 8 }}>
              {en ? "Enter Dashboard (Test Mode)" : "进入仪表盘（测试模式）"}
            </a>
          </div>
        )}
      </div>
    </section>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { billing, session } = await authenticate.admin(request);
    const shopDomain = session?.shop || "";
    const isTest = await computeIsTestMode(shopDomain);
    const appUrl = requireEnv("SHOPIFY_APP_URL");
    await billing.request({ plan: BILLING_PLAN, isTest, returnUrl: `${appUrl}/app/billing/confirm` });
    return null;
  } catch (e) {
    if (e instanceof Response) throw e;
    return null;
  }
};
