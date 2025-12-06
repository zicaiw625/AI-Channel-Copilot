import type { LoaderFunctionArgs } from "react-router";
import crypto from "crypto";
import { getSettings } from "../lib/settings.server";
import { buildLlmsTxt, getLlmsTxtCache } from "../lib/llms.server";
import { logger } from "../lib/logger.server";
import { readCriticalEnv } from "../lib/env.server";
import { enforceRateLimit, RateLimitRules, getClientIp, buildRateLimitKey } from "../lib/security/rateLimit.server";

/**
 * Verify Shopify App Proxy signature
 * @see https://shopify.dev/docs/apps/build/online-store/display-data-on-online-stores#verify-the-request
 */
function verifyAppProxySignature(
  query: URLSearchParams,
  apiSecret: string,
): boolean {
  const signature = query.get("signature");
  if (!signature) return false;
  
  // 验证签名格式：只允许十六进制字符，避免恶意输入
  if (!/^[0-9a-f]+$/i.test(signature)) {
    return false;
  }

  // Build the message by sorting query params (excluding signature)
  const params: string[] = [];
  query.forEach((value, key) => {
    if (key !== "signature") {
      params.push(`${key}=${value}`);
    }
  });
  params.sort();
  const message = params.join("");

  // Calculate expected signature
  const expectedSignature = crypto
    .createHmac("sha256", apiSecret)
    .update(message)
    .digest("hex");

  // 确保长度相同后再进行常量时间比较
  // 这避免了通过长度差异泄露信息
  if (signature.length !== expectedSignature.length) {
    return false;
  }

  // Constant-time comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expectedSignature, "hex"),
    );
  } catch {
    // Buffer.from 失败（如无效的十六进制）时返回 false
    return false;
  }
}

/**
 * App Proxy endpoint for llms.txt
 * Accessible at: https://{shop-domain}/a/llms
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const query = url.searchParams;
  const shopDomain = query.get("shop") || "";
  const clientIp = getClientIp(request);

  // 1. IP 级别的全局速率限制（在签名验证之前，防止 DDoS）
  try {
    await enforceRateLimit(
      buildRateLimitKey("proxy", "ip", clientIp),
      RateLimitRules.GLOBAL_IP
    );
  } catch (error) {
    if (error instanceof Response) {
      logger.warn("[proxy.llms] IP rate limit exceeded", { clientIp });
      return error;
    }
    throw error;
  }

  // 2. Verify the request signature
  const { SHOPIFY_API_SECRET: apiSecret } = readCriticalEnv();
  const isValid = verifyAppProxySignature(query, apiSecret);

  if (!isValid) {
    logger.warn("[proxy.llms] Invalid signature", { shopDomain, clientIp });
    return new Response("Unauthorized", { status: 401 });
  }

  if (!shopDomain) {
    return new Response("Missing shop parameter", { status: 400 });
  }

  // 3. 店铺级别的速率限制（签名验证后）
  try {
    await enforceRateLimit(
      buildRateLimitKey("proxy", "shop", shopDomain),
      RateLimitRules.PROXY
    );
  } catch (error) {
    if (error instanceof Response) {
      logger.warn("[proxy.llms] Shop rate limit exceeded", { shopDomain });
      return error;
    }
    throw error;
  }

  try {
    const settings = await getSettings(shopDomain);

    // Check if any exposure preference is enabled
    const { exposurePreferences } = settings;
    const hasAnyExposure =
      exposurePreferences.exposeProducts ||
      exposurePreferences.exposeCollections ||
      exposurePreferences.exposeBlogs;

    if (!hasAnyExposure) {
      // Return a minimal llms.txt indicating no content is exposed
      const language = settings.languages?.[0] || "中文";
      const noContentText =
        language === "English"
          ? `# llms.txt · AI crawling preferences
# This store has not enabled any content for AI crawling.
# Contact the store owner for more information.
`
          : `# llms.txt · AI 采集偏好声明
# 此店铺尚未开启任何内容供 AI 采集。
# 如需了解更多信息，请联系店铺所有者。
`;
      return new Response(noContentText, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "public, max-age=3600", // Cache for 1 hour
        },
      });
    }

    // Try to get cached content first (includes collections/blogs from admin)
    const cached = await getLlmsTxtCache(shopDomain);
    if (cached) {
      logger.info("[proxy.llms] Served cached llms.txt", { shopDomain, cachedAt: cached.cachedAt.toISOString() });
      return new Response(cached.text, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "public, max-age=3600",
          "X-Cache": "HIT",
          "X-Cache-Date": cached.cachedAt.toISOString(),
        },
      });
    }

    // Generate llms.txt content (without admin client, collections/blogs will be limited)
    const text = await buildLlmsTxt(shopDomain, settings, {
      range: "30d",
      topN: 20,
      admin: undefined, // No admin access in proxy context
    });

    logger.info("[proxy.llms] Served generated llms.txt (no cache)", { shopDomain });

    return new Response(text, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
        "X-Cache": "MISS",
      },
    });
  } catch (error) {
    logger.error("[proxy.llms] Error generating llms.txt", { shopDomain }, {
      error: (error as Error).message,
    });
    return new Response("Internal Server Error", { status: 500 });
  }
};
