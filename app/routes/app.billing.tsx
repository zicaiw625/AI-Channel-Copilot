import type { HeadersFunction, LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { useEffect, useState } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { requireEnv } from "../lib/env.server";
import { ensureBilling, hasActiveSubscription } from "../lib/billing.server";
import { getSettings, syncShopPreferences } from "../lib/settings.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session?.shop || "";
  let settings = await getSettings(shopDomain);
  settings = await syncShopPreferences(admin, shopDomain, settings);
  const planName = requireEnv("BILLING_PLAN_NAME");
  const ok = await hasActiveSubscription(admin as any, planName);
  const amount = Number(process.env.BILLING_PRICE || "5");
  const currencyCode = process.env.BILLING_CURRENCY || "USD";
  const trialDays = Number(process.env.BILLING_TRIAL_DAYS || "7");
  const interval = process.env.BILLING_INTERVAL || "EVERY_30_DAYS";
  const language = settings.languages[0] || "中文";
  return { language, planName, active: ok, amount, currencyCode, trialDays, interval };
};

export default function Billing() {
  const { language, planName, active, amount, currencyCode, trialDays, interval } = useLoaderData<typeof loader>();
  const [uiLanguage, setUiLanguage] = useState(language);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("aicc_language");
      if (stored && stored !== uiLanguage) setUiLanguage(stored);
    } catch {}
    const onStorage = (e: StorageEvent) => {
      if (e.key === "aicc_language" && typeof e.newValue === "string") {
        setUiLanguage(e.newValue);
      }
    };
    const onCustom = (e: Event) => {
      try {
        const detail = (e as CustomEvent).detail as string | undefined;
        if (detail && detail !== uiLanguage) setUiLanguage(detail);
      } catch {}
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("aicc_language_change", onCustom as EventListener);
    return () => window.removeEventListener("storage", onStorage);
  }, [uiLanguage]);
  return (
    <section style={{ padding: 16 }}>
      <h2>{active ? (uiLanguage === "English" ? "Subscription Active" : "订阅已激活") : (uiLanguage === "English" ? "Subscription & Trial" : "订阅与试用")}</h2>
      <p>{active ? (uiLanguage === "English" ? `Current plan: ${planName}` : `当前计划：${planName}`) : (uiLanguage === "English" ? "Click the button below to jump to Shopify confirmation and complete subscription." : "点击下方按钮将跳转至 Shopify 确认页以完成订阅。")}</p>
      <p>
        {uiLanguage === "English"
          ? `Price: ${amount} ${currencyCode}, Interval: ${interval}, Trial: ${trialDays} days`
          : `价格：${amount} ${currencyCode}，周期：${interval}，试用：${trialDays} 天`}
      </p>
      {!active && (
        <form method="post">
          <button type="submit">{uiLanguage === "English" ? "Start Subscription" : "开始订阅"}</button>
        </form>
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
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session?.shop || "";
  await ensureBilling(admin as any, shopDomain, request);
  return null;
};
