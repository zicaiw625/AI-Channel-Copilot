import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getSettings } from "../lib/settings.server";
import { buildLlmsTxt, updateLlmsTxtCache } from "../lib/llms.server";
import { hasFeature, FEATURES } from "../lib/access.server";
import { logger } from "../lib/logger.server";
import { enforceRateLimit, RateLimitRules } from "../lib/security/rateLimit.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session?.shop || "";
    if (!shopDomain) {
      return Response.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }

  // 速率限制：使用 EXPORT 规则（5 次/5 分钟）防止滥用
  try {
    await enforceRateLimit(`llms-preview:${shopDomain}`, RateLimitRules.EXPORT);
  } catch (error) {
    if (error instanceof Response) {
      // 转换为统一的响应格式，确保前端能正确解析
      return Response.json(
        { ok: false, message: "Rate limit exceeded. Please wait a moment." },
        { status: 429 }
      );
    }
    throw error;
  }

  const allowed = await hasFeature(shopDomain, FEATURES.EXPORTS);
  if (!allowed) {
    return Response.json({ ok: false, message: "Upgrade required" }, { status: 403 });
  }

  try {
    const settings = await getSettings(shopDomain);
    
    // Allow overriding language from query param (for preview to match UI selection)
    // Only accept valid language values to ensure type safety
    const langParam = url.searchParams.get("lang");
    const validLanguages = ["English", "中文"] as const;
    const isValidLang = langParam && validLanguages.includes(langParam as typeof validLanguages[number]);
    // Track whether we're using a language override (not yet saved to DB)
    const isLanguageOverride = isValidLang && langParam !== settings.languages?.[0];
    const settingsWithLang = isValidLang
      ? { ...settings, languages: [langParam, ...(settings.languages || []).filter((l: string) => l !== langParam)] }
      : settings;
    
    // Pass admin client to enable fetching collections and blogs from Shopify API
    const text = await buildLlmsTxt(shopDomain, settingsWithLang, { 
      range: "30d", 
      topN: 20,
      admin: admin || undefined,
    });

    // Update cache when we have admin access (includes collections/blogs)
    // IMPORTANT: Only update cache if NOT using a language override from query params
    // This ensures the cached llms.txt matches the saved DB settings, not unsaved UI selections
    if (admin && shopDomain && !isLanguageOverride) {
      // Fire and forget - don't block response, but log errors
      updateLlmsTxtCache(shopDomain, text).catch((error) => {
        logger.warn("[llms-preview] Cache update failed", { shopDomain }, {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }

    const download = url.searchParams.get("download") === "1";
    if (download) {
      return new Response(text, {
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "content-disposition": "attachment; filename=llms.txt",
        },
      });
    }

    return Response.json({ ok: true, text });
  } catch (error) {
    logger.error("[llms-preview] Failed to generate llms.txt", { shopDomain }, {
      error: error instanceof Error ? error.message : String(error),
    });
    return Response.json(
      { ok: false, message: "Failed to generate preview. Please try again." },
      { status: 500 }
    );
  }
};
