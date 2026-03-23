import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { unauthenticated } from "../shopify.server";
import {
  syncSubscriptionFromShopify,
} from "../lib/billing.server";
import { requireEnv } from "../lib/env.server";
import { enforceRateLimit, RateLimitRules, buildRateLimitKey } from "../lib/security/rateLimit.server";
import { logger } from "../lib/logger.server";
import prisma from "../db.server";
import { extractAdminClient } from "../lib/graphqlSdk.server";
import { buildEmbeddedAppPath } from "../lib/navigation";

/**
 * 🔒 Shop 域名格式校验
 * 防止恶意构造的 shop 参数被用于滥用 Admin API
 */
const SHOP_DOMAIN_REGEX = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

const isValidShopDomain = (shop: string): boolean => {
  if (!shop || typeof shop !== "string") return false;
  if (shop.length > 255) return false;  // 域名长度限制
  return SHOP_DOMAIN_REGEX.test(shop);
};

/**
 * 🔒 检查店铺是否有有效的 offline session/token
 * 如果没有，说明该店铺从未安装过应用，不应该调用 Admin API
 */
const hasValidOfflineSession = async (shopDomain: string): Promise<boolean> => {
  try {
    const session = await prisma.session.findFirst({
      where: {
        shop: shopDomain,
        isOnline: false,  // offline token
        accessToken: { not: "" },
      },
      select: { id: true },
    });
    return !!session;
  } catch {
    return false;
  }
};

/**
 * 🔒 获取客户端标识用于限流
 */
const getClientIdentifier = (request: Request): string => {
  // 优先使用 CF-Connecting-IP (Cloudflare) 或 X-Forwarded-For
  const cfIp = request.headers.get("CF-Connecting-IP");
  const xForwardedFor = request.headers.get("X-Forwarded-For");
  const realIp = request.headers.get("X-Real-IP");
  
  if (cfIp) return cfIp.split(",")[0].trim();
  if (xForwardedFor) return xForwardedFor.split(",")[0].trim();
  if (realIp) return realIp.trim();
  
  // 回退到 user-agent hash（不太可靠但总比没有好）
  return request.headers.get("User-Agent") || "unknown";
};

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
    } catch (err) {
      // 302 Response 也会作为异常被捕获；不要吞掉重定向，否则 cookie fallback 永远不会生效。
      if (err instanceof Response) throw err;
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
    const next = buildEmbeddedAppPath("/app", url.search);
    throw new Response(null, { status: 302, headers: { Location: next } });
  }

  // 🔒 安全校验 1: Shop 域名格式硬校验
  if (!isValidShopDomain(shopDomain)) {
    logger.warn("[billing-confirm] Invalid shop domain format rejected", {
      shopDomain: shopDomain.slice(0, 100),  // 截断避免日志注入
    });
    return new Response("Invalid shop parameter", { status: 400 });
  }

  // 🔒 安全校验 2: 限流（按 IP + shop 组合）
  const clientId = getClientIdentifier(request);
  try {
    await enforceRateLimit(
      buildRateLimitKey("billing-confirm", clientId, shopDomain),
      RateLimitRules.API_DEFAULT  // 使用 API 级别限流规则
    );
  } catch (rateLimitError) {
    if (rateLimitError instanceof Response && rateLimitError.status === 429) {
      logger.warn("[billing-confirm] Rate limit exceeded", {
        shopDomain,
        clientId: clientId.slice(0, 50),
      });
      return new Response("Too many requests", { status: 429 });
    }
    throw rateLimitError;
  }

  // 🔒 安全校验 3: 检查是否有有效的 offline session
  // 如果没有，说明该店铺从未正确安装过应用，不应该调用 Admin API
  const hasSession = await hasValidOfflineSession(shopDomain);
  if (!hasSession) {
    logger.info("[billing-confirm] No valid session for shop, redirecting to app", {
      shopDomain,
    });
    // 重定向到 app，触发正常的 OAuth 流程
    const next = buildEmbeddedAppPath("/app", url.search, { shop: shopDomain });
    throw new Response(null, { status: 302, headers: { Location: next } });
  }

  // 关键改动：
  // billing confirm 不依赖 embedded session（容易在 Shopify approve 回跳时丢失），
  // 直接用 offline token（unauthenticated.admin）去 Shopify 拉取并同步订阅状态。
  try {
    const unauth = await unauthenticated.admin(shopDomain);
    // 使用统一的类型安全辅助函数提取 admin 客户端
    const admin = extractAdminClient(unauth);
    if (admin) {
      await syncSubscriptionFromShopify(admin, shopDomain);
    }
  } catch (error) {
    // control flow: 不要吞掉 SDK 可能抛出的重定向 Response
    if (error instanceof Response) throw error;
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
