import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { requireEnv } from "../lib/env.server";
import { ensureBilling, hasActiveSubscription } from "../lib/billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session?.shop || "";
  await ensureBilling(admin as any, shopDomain, request);
  const planName = requireEnv("BILLING_PLAN_NAME");
  const ok = await hasActiveSubscription(admin as any, planName);
  return { planName, active: ok };
};

export default function Billing() {
  const { planName, active } = useLoaderData<typeof loader>();
  return (
    <section style={{ padding: 16 }}>
      <h2>{active ? "订阅已激活" : "订阅与试用"}</h2>
      <p>{active ? `当前计划：${planName}` : "进入本页将自动检查并跳转至 Shopify 确认页以完成订阅。"}</p>
    </section>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

