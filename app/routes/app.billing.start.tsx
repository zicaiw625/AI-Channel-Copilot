import type { HeadersFunction, ActionFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { isDemoMode } from "../lib/runtime.server";

/**
 * 托管定价模式下，此路由已弃用
 * 订阅管理通过 Shopify 设置页面进行
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const demo = isDemoMode();
  
  if (demo) {
    return Response.json({
      ok: false,
      message: "Demo mode: billing is disabled.",
    });
  }
  
  try {
    const { session } = await authenticate.admin(request);
    const shopDomain = session?.shop || "";
    
    // 托管定价模式：引导用户去 Shopify 设置页面
    return Response.json({
      ok: false,
      message: "Managed Pricing mode: Please manage your subscription in Shopify settings.",
      redirectUrl: `https://${shopDomain}/admin/settings/apps`,
    });
  } catch (error) {
    if (error instanceof Response) throw error;
    return Response.json({
      ok: false,
      message: "Action failed. Please try again.",
    });
  }
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
