import type { LoaderFunctionArgs } from "react-router";
import crypto from "crypto";
import { getSettings } from "../lib/settings.server";
import { buildLlmsTxt, getLlmsTxtCache } from "../lib/llms.server";
import { logger } from "../lib/logger.server";
import { readCriticalEnv } from "../lib/env.server";

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

  // Constant-time comparison
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expectedSignature, "hex"),
    );
  } catch {
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

  // Verify the request signature
  const { SHOPIFY_API_SECRET: apiSecret } = readCriticalEnv();
  const isValid = verifyAppProxySignature(query, apiSecret);

  if (!isValid) {
    logger.warn("[proxy.llms] Invalid signature", { shopDomain });
    return new Response("Unauthorized", { status: 401 });
  }

  if (!shopDomain) {
    return new Response("Missing shop parameter", { status: 400 });
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
