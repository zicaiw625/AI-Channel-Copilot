import type { HeadersFunction, LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { requireEnv } from "../lib/env.server";
import { ensureBilling, hasActiveSubscription } from "../lib/billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session?.shop || "";
  const planName = requireEnv("BILLING_PLAN_NAME");
  const ok = await hasActiveSubscription(admin as any, planName);
  const amount = Number(process.env.BILLING_PRICE || "5");
  const currencyCode = process.env.BILLING_CURRENCY || "USD";
  const trialDays = Number(process.env.BILLING_TRIAL_DAYS || "7");
  const interval = process.env.BILLING_INTERVAL || "EVERY_30_DAYS";
  return { planName, active: ok, amount, currencyCode, trialDays, interval };
};

export default function Billing() {
  const { planName, active, amount, currencyCode, trialDays, interval } = useLoaderData<typeof loader>();
  return (
    <section style={{ padding: 16 }}>
      <h2>{active ? "订阅已激活" : "订阅与试用"}</h2>
      <p>{active ? `当前计划：${planName}` : "点击下方按钮将跳转至 Shopify 确认页以完成订阅。"}</p>
      <p>{`价格：${amount} ${currencyCode}，周期：${interval}，试用：${trialDays} 天`}</p>
      {!active && (
        <form method="post">
          <button type="submit">开始订阅</button>
        </form>
      )}
      {active && <p>如需管理或取消，请在 Shopify 后台的账单页面操作。</p>}
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
