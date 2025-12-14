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
      return error;
    }
    throw error;
  }

  const allowed = await hasFeature(shopDomain, FEATURES.EXPORTS);
  if (!allowed) {
    return Response.json({ ok: false, message: "Upgrade required" }, { status: 403 });
  }

  const settings = await getSettings(shopDomain);
  
  // Allow overriding language from query param (for preview to match UI selection)
  // Only accept valid language values to ensure type safety
  const langParam = url.searchParams.get("lang");
  const validLanguages = ["English", "中文"] as const;
  const isValidLang = langParam && validLanguages.includes(langParam as typeof validLanguages[number]);
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
  if (admin && shopDomain) {
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
};
