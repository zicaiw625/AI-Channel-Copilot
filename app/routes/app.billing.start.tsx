import type { HeadersFunction, ActionFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate, MONTHLY_PLAN } from "../shopify.server";
import { requireEnv } from "../lib/env.server";
import { computeIsTestMode, detectAndPersistDevShop } from "../lib/billing.server";
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
    const { admin, billing, session } = await authenticate.admin(request);
    const shopDomain = session?.shop || "";
    
    // 先检测并持久化开发店状态，确保 isTest 计算正确
    await detectAndPersistDevShop(admin, shopDomain);
    const isTest = await computeIsTestMode(shopDomain);
    // 关键：returnUrl 必须携带 shop/host 等上下文，否则确认回跳会丢失 session → 触发 /auth/login
    const reqUrl = new URL(request.url);
    const appUrl = requireEnv("SHOPIFY_APP_URL");
    const returnUrl = new URL("/app/billing/confirm", appUrl);
    returnUrl.searchParams.set("shop", shopDomain);
    const host = reqUrl.searchParams.get("host");
    if (host) returnUrl.searchParams.set("host", host);
    const embedded = reqUrl.searchParams.get("embedded");
    if (embedded) returnUrl.searchParams.set("embedded", embedded);
    const locale = reqUrl.searchParams.get("locale");
    if (locale) returnUrl.searchParams.set("locale", locale);
    // Use MONTHLY_PLAN directly as the plan name for billing request
    // Type assertion needed because plan names are dynamic (from env config)
    await billing.request({ 
      plan: MONTHLY_PLAN as Parameters<typeof billing.request>[0]["plan"], 
      isTest, 
      returnUrl: returnUrl.toString(),
    });
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
