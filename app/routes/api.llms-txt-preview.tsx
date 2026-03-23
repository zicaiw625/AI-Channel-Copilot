import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getSettings } from "../lib/settings.server";
import { buildLlmsTxt } from "../lib/llms.server";
import { hasFeature, FEATURES } from "../lib/access.server";
import { logger } from "../lib/logger.server";
import { enforceRateLimit, RateLimitRules } from "../lib/security/rateLimit.server";
import { normalizeLanguageCode, toUILanguage } from "../lib/language";
import { resolveUILanguageFromRequest } from "../lib/language.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const auth = await authenticate.admin(request);
  if (auth instanceof Response) throw auth;
  const { admin, session } = auth;
  const shopDomain = session?.shop || "";
  if (!shopDomain) {
    return Response.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }

  const download = url.searchParams.get("download") === "1";
  const rateLimitRule = download ? RateLimitRules.EXPORT : RateLimitRules.POLLING;

  // 下载走严格限流，页面内预览走更宽松的轮询级限流。
  try {
    await enforceRateLimit(`llms-preview:${shopDomain}`, rateLimitRule);
  } catch (error) {
    if (error instanceof Response) {
      return Response.json(
        { ok: false, message: "Rate limit exceeded. Please wait a moment." },
        { status: 429 }
      );
    }
    throw error;
  }

  const allowed = await hasFeature(shopDomain, FEATURES.LLMS_ADVANCED);
  if (!allowed) {
    return Response.json({ ok: false, message: "Upgrade required" }, { status: 403 });
  }

  try {
    const settings = await getSettings(shopDomain);
    
    // Allow overriding language from query param (for preview to match UI selection)
    // Only accept valid language values to ensure type safety
    const langCode = normalizeLanguageCode(url.searchParams.get("lang"));
    const cookieLanguage = resolveUILanguageFromRequest(request, settings.languages?.[0] || "中文");
    const nextLanguage = langCode ? toUILanguage(langCode) : cookieLanguage;

    // 预览必须与当前语言一致：即使 URL 没有提供 lang，也用 cookie 语言覆盖 settings.languages[0]
    const settingsWithLang = {
      ...settings,
      languages: [nextLanguage, ...(settings.languages || []).filter((l: string) => l !== nextLanguage)],
    };
    
    // Pass admin client to enable fetching collections and blogs from Shopify API
    const text = await buildLlmsTxt(shopDomain, settingsWithLang, { 
      range: "30d", 
      topN: 20,
      admin: admin || undefined,
      language: nextLanguage,
    });

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
