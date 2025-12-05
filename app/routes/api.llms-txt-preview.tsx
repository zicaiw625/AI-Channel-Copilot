import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getSettings } from "../lib/settings.server";
import { buildLlmsTxt, updateLlmsTxtCache } from "../lib/llms.server";
import { hasFeature, FEATURES } from "../lib/access.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  let shopDomain = "";
  let admin = null;
  
  try {
    const auth = await authenticate.admin(request);
    admin = auth.admin;
    shopDomain = auth.session?.shop || url.searchParams.get("shop") || "";
  } catch (authError) {
    shopDomain = url.searchParams.get("shop") || "";
    if (!shopDomain) {
      return Response.json({ ok: false, message: "Unauthorized" }, { status: 401 });
    }
  }

  const allowed = await hasFeature(shopDomain, FEATURES.EXPORTS);
  if (!allowed) {
    return Response.json({ ok: false, message: "Upgrade required" }, { status: 403 });
  }

  const settings = await getSettings(shopDomain);
  
  // Allow overriding language from query param (for preview to match UI selection)
  const langParam = url.searchParams.get("lang");
  const settingsWithLang = langParam 
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
    // Fire and forget - don't block response
    updateLlmsTxtCache(shopDomain, text).catch(() => {});
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
