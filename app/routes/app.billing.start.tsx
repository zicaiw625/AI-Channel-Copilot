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
    const appUrl = requireEnv("SHOPIFY_APP_URL");
    const url = new URL(request.url);
    const host = url.searchParams.get("host");
    const embedded = url.searchParams.get("embedded");
    const locale = url.searchParams.get("locale");
    const lang = url.searchParams.get("lang");

    // IMPORTANT:
    // Shopify billing approval redirects back to `returnUrl` in a top-level context
    // and often without our app session cookies. If `shop` (and ideally `host/embedded`)
    // are missing, Shopify SDK may redirect to `/auth/login` which is blocked in prod
    // and results in a 404 after approving a charge.
    const returnUrl = new URL("/app/billing/confirm", appUrl);
    returnUrl.searchParams.set("shop", shopDomain);
    if (host) returnUrl.searchParams.set("host", host);
    if (embedded) returnUrl.searchParams.set("embedded", embedded);
    if (locale) returnUrl.searchParams.set("locale", locale);
    if (lang) returnUrl.searchParams.set("lang", lang);

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
