import type { HeadersFunction, LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useUILanguage } from "../lib/useUILanguage";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate, BILLING_PLAN } from "../shopify.server";
import { requireEnv } from "../lib/env.server";
import { getSettings, syncShopPreferences } from "../lib/settings.server";
import { detectAndPersistDevShop, computeIsTestMode } from "../lib/billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const demo = process.env.DEMO_MODE === "true";
  type AuthShape = Awaited<ReturnType<typeof authenticate.admin>>;
  let admin: AuthShape["admin"] | null = null;
  let billing: AuthShape["billing"] | null = null;
  let session: AuthShape["session"] | null = null;
  try {
    const auth = await authenticate.admin(request);
    admin = auth.admin;
    billing = auth.billing;
    session = auth.session;
  } catch (e) {
    if (!demo) throw e;
  }
  const shopDomain = session?.shop || "";
  let settings = await getSettings(shopDomain);
  settings = await syncShopPreferences(admin, shopDomain, settings);
  const isDev = await detectAndPersistDevShop(admin, shopDomain);
  const isTest = await computeIsTestMode(shopDomain);
  const billingEnabled = process.env.ENABLE_BILLING === "true";
  const billingCheck = (demo || !billingEnabled || isDev)
    ? { hasActivePayment: true }
    : await billing.check({ plans: [BILLING_PLAN], isTest });
  const amount = Number(process.env.BILLING_PRICE || "5");
  const currencyCode = process.env.BILLING_CURRENCY || "USD";
  const trialDays = Number(process.env.BILLING_TRIAL_DAYS || "7");
  const interval = process.env.BILLING_INTERVAL || "EVERY_30_DAYS";
  const language = settings.languages[0] || "中文";
  return { language, planName: BILLING_PLAN, active: billingCheck.hasActivePayment, amount, currencyCode, trialDays, interval, shopDomain, demo };
};

export default function Billing() {
  const { language, planName, active, amount, currencyCode, trialDays, interval, shopDomain, demo } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ ok: boolean; message?: string }>();
  const uiLanguage = useUILanguage(language);
  
  const handleStartSubscription = () => {
    fetcher.submit(
      { shop: shopDomain },
      { method: "post" }
    );
  };
  
  return (
    <section style={{ padding: 16 }}>
      <h2>{active ? (uiLanguage === "English" ? "Subscription Active" : "订阅已激活") : (uiLanguage === "English" ? "Subscription & Trial" : "订阅与试用")}</h2>
      {fetcher.data && !fetcher.data.ok && (
        <div style={{ marginTop: 8, padding: 10, background: "#fff2e8", border: "1px solid #ffd7c2", color: "#b25b1a" }}>
          {fetcher.data.message || (uiLanguage === "English" ? "Failed to start subscription. Please try again." : "订阅启动失败，请重试。")}
        </div>
      )}
      {demo && (
        <div style={{ marginTop: 8, padding: 10, background: "#e6f7ff", border: "1px solid #91d5ff", color: "#0050b3" }}>
          {uiLanguage === "English" ? "Demo mode: Billing is disabled. You can explore the dashboard with sample data." : "Demo 模式：计费功能已禁用。您可以使用示例数据探索仪表盘。"}
        </div>
      )}
      <p>{active ? (uiLanguage === "English" ? `Current plan: ${planName}` : `当前计划：${planName}`) : (uiLanguage === "English" ? "Click the button below to jump to Shopify confirmation and complete subscription." : "点击下方按钮将跳转至 Shopify 确认页以完成订阅。")}</p>
      <p>
        {uiLanguage === "English"
          ? `Price: ${amount} ${currencyCode}, Interval: ${interval}, Trial: ${trialDays} days`
          : `价格：${amount} ${currencyCode}，周期：${interval}，试用：${trialDays} 天`}
      </p>
      {!active && !demo && (
        <button 
          type="button" 
          onClick={handleStartSubscription}
          disabled={fetcher.state !== "idle"}
        >
          {fetcher.state !== "idle" 
            ? (uiLanguage === "English" ? "Processing..." : "处理中...")
            : (uiLanguage === "English" ? "Start Subscription" : "开始订阅")}
        </button>
      )}
      {demo && (
        <div style={{ marginTop: 8 }}>
          <s-link href="/app">
            {uiLanguage === "English" ? "Enter Dashboard (Demo Mode)" : "进入仪表盘（Demo 模式）"}
          </s-link>
        </div>
      )}
      {active && (
        <p>{uiLanguage === "English" ? "To manage or cancel, go to Shopify billing page." : "如需管理或取消，请在 Shopify 后台的账单页面操作。"}</p>
      )}
    </section>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const demo = process.env.DEMO_MODE === "true";
  
  // Demo 模式下，订阅功能不可用
  if (demo) {
    return Response.json({
      ok: false,
      message: "Demo mode: billing is disabled. Install the app in a real Shopify store to subscribe.",
    });
  }
  
  try {
    const { billing, session } = await authenticate.admin(request);
    const shopDomain = session?.shop || "";
    const isTest = await computeIsTestMode(shopDomain);
    const appUrl = requireEnv("SHOPIFY_APP_URL");
    await billing.request({ plan: BILLING_PLAN, isTest, returnUrl: `${appUrl}/app/billing/confirm` });
    return null;
  } catch (error) {
    if (error instanceof Response) throw error;
    // 返回错误消息给 UI，而不是静默失败
    return Response.json({
      ok: false,
      message: "Failed to start subscription. Please try again.",
    });
  }
};
