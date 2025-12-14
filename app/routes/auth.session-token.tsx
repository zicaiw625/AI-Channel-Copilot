import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

/**
 * Shopify Embedded App session token exchange endpoint.
 *
 * Important:
 * - In some flows (e.g. billing confirm / iframe reload), Shopify SDK may return a Response
 *   from `authenticate.admin(request)` (HTML/redirect) instead of throwing.
 * - If we accidentally treat it as an object, we return `null` and render a blank page.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const result = await authenticate.admin(request);
  // If Shopify SDK returns a Response (e.g. HTML/redirect), return it as-is.
  if (result instanceof Response) return result;
  /**
   * Fallback:
   * 在某些情况下 request 已经是可用会话，SDK 可能返回 { admin, session } 对象而不是 HTML Response。
   * 如果此时返回 204，会在 Shopify Admin iframe 中表现为“白屏卡住”。
   * 这里改为：优先重定向回 shopify-reload 指定的目标页面，确保流程继续。
   */
  const url = new URL(request.url);
  const reload = url.searchParams.get("shopify-reload");
  if (reload) {
    try {
      const reloadUrl = new URL(reload);
      // 防止开放重定向：只允许跳回同源地址（通常就是你的 Render 域名）
      if (reloadUrl.origin === url.origin) {
        return redirect(reloadUrl.toString());
      }
    } catch {
      // ignore malformed reload url
    }
  }
  return redirect(`/app${url.search}`);
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

