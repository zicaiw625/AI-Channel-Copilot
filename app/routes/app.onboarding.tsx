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
  return { language: settings.languages[0] || "中文", planName: BILLING_PLAN, trialDays, price, currency, isDevShop };
};

export default function Onboarding() {
  const { language, planName, trialDays, price, currency, isDevShop } = useLoaderData<typeof loader>();
  const en = language === "English";
  return (
    <section style={{ padding: 16 }}>
      <h2>{en ? "Welcome to AI Channel Copilot" : "欢迎使用 AI Channel Copilot"}</h2>
      <p>{en ? "Understand what the app does and permissions required." : "了解应用功能与所需权限说明。"}</p>
      <p>{en ? "We may start a historical order sync without payment." : "无需付费即可启动历史订单数据同步。"}</p>
      <div style={{ marginTop: 16, padding: 12, background: "#f7f7f7" }}>
        <p>
          {en
            ? `Start ${trialDays} days free trial, then ${price}/${currency} every 30 days (cancel anytime in Shopify).`
            : `开始 ${trialDays} 天免费试用，之后每 30 天 ${price}/${currency}（可在 Shopify 随时取消）。`}
        </p>
        {!isDevShop && trialDays >= 0 && (
          <form method="post">
            <button type="submit">{en ? "Start Free Trial" : "开始免费试用"}</button>
          </form>
        )}
        {isDevShop && (
          <p>{en ? "Development store detected: app is free for testing." : "检测到开发/测试店：应用将永久免费用于测试。"}</p>
        )}
      </div>
    </section>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);
  const shopDomain = session?.shop || "";
  const isTest = await computeIsTestMode(shopDomain);
  const appUrl = requireEnv("SHOPIFY_APP_URL");
  await billing.request({ plan: BILLING_PLAN, isTest, returnUrl: `${appUrl}/app/billing/confirm` });
  return null;
};
