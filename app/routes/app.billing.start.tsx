import type { HeadersFunction, ActionFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate, BILLING_PLAN } from "../shopify.server";
import { requireEnv } from "../lib/env.server";
import { computeIsTestMode } from "../lib/billing.server";
import { isDemoMode } from "../lib/runtime.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const demo = isDemoMode();
  
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

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
