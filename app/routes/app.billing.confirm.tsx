import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { syncSubscriptionFromShopify } from "../lib/billing.server";

/**
 * 托管定价模式下的订阅确认页面
 * 此路由现在只是从 Shopify 同步订阅状态，然后重定向到主应用
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session?.shop || "";
  
  // 从 Shopify 同步订阅状态
  await syncSubscriptionFromShopify(admin, shopDomain);
  
  // 重定向到主应用
  const url = new URL(request.url);
  const next = new URL("/app", url.origin);
  next.search = url.search;
  throw new Response(null, { status: 302, headers: { Location: next.toString() } });
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
