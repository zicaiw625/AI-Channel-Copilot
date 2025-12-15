import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { unauthenticated } from "../shopify.server";
import {
  syncSubscriptionFromShopify,
} from "../lib/billing.server";
import { requireEnv } from "../lib/env.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const cookieHeader = request.headers.get("Cookie") || "";
  const readCookie = (name: string): string | null => {
    const parts = cookieHeader.split(";").map((p) => p.trim());
    for (const part of parts) {
      if (!part) continue;
      const eq = part.indexOf("=");
      if (eq === -1) continue;
      const k = part.slice(0, eq).trim();
      if (k !== name) continue;
      return part.slice(eq + 1);
    }
    return null;
  };
  const clearCookie = (name: string) => `${name}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`;

  // 1) cookie 兜底（最可靠）：从 /app/redirect 写入的短期 cookie 恢复 shop/host 上下文
  const ctxRaw = readCookie("aicc_billing_ctx");
  if (ctxRaw) {
    try {
      const ctx = new URLSearchParams(decodeURIComponent(ctxRaw));
      const shop = ctx.get("shop");
      const host = ctx.get("host");
      const embedded = ctx.get("embedded");
      const locale = ctx.get("locale");
      let changed = false;
      if (!url.searchParams.get("shop") && shop) {
        url.searchParams.set("shop", shop);
        changed = true;
      }
      if (!url.searchParams.get("host") && host) {
        url.searchParams.set("host", host);
        changed = true;
      }
      if (!url.searchParams.get("embedded") && embedded) {
        url.searchParams.set("embedded", embedded);
        changed = true;
      }
      if (!url.searchParams.get("locale") && locale) {
        url.searchParams.set("locale", locale);
        changed = true;
      }
      if (changed) {
        throw new Response(null, {
          status: 302,
          headers: { Location: url.toString(), "Set-Cookie": clearCookie("aicc_billing_ctx") },
        });
      }
    } catch {
      // ignore cookie parsing errors
    }
  }

  // 兼容旧的 returnUrl（没带 shop/host）导致 approve 回跳后无法鉴权：
  // 尝试从 Referer 推断 shop，再把它补回 query 里，避免落到 /auth/login(生产环境 404)。
  if (!url.searchParams.get("shop")) {
    const referer = request.headers.get("referer") || request.headers.get("referrer") || "";
    // 常见 referer: https://{shop}.myshopify.com/admin/...
    const match = referer.match(/https?:\/\/([a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com)(?:\/|$)/);
    const inferredShop = match?.[1];
    if (inferredShop) {
      url.searchParams.set("shop", inferredShop);
      throw new Response(null, { status: 302, headers: { Location: url.toString() } });
    }
  }

  const shopDomain = url.searchParams.get("shop") || "";
  // 如果连 shop 都没有，无法继续；让它回到 app（后续会触发标准 /auth 流程）
  if (!shopDomain) {
    const next = new URL("/app", url.origin);
    next.search = url.search;
    throw new Response(null, { status: 302, headers: { Location: next.toString() } });
  }

  // 关键改动：
  // billing confirm 不依赖 embedded session（容易在 Shopify approve 回跳时丢失），
  // 直接用 offline token（unauthenticated.admin）去 Shopify 拉取并同步订阅状态。
  try {
    const unauth = await unauthenticated.admin(shopDomain);
    const admin =
      unauth && typeof (unauth as any).graphql === "function"
        ? (unauth as any)
        : (unauth as any)?.admin;
    if (admin && typeof admin.graphql === "function") {
      await syncSubscriptionFromShopify(admin, shopDomain);
    }
  } catch {
    // ignore — 即使同步失败，也继续把用户送回应用；应用内会再走正常鉴权/引导
  }

  // 强制回到 Shopify Admin 内打开应用（最稳，避免停留在计费确认页/顶层窗口）
  const apiKey = requireEnv("SHOPIFY_API_KEY");
  const shopPrefix = shopDomain.split(".")[0] || shopDomain;
  const openAppUrl = `https://admin.shopify.com/store/${shopPrefix}/apps/${apiKey}`;
  throw new Response(null, { status: 302, headers: { Location: openAppUrl } });
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
