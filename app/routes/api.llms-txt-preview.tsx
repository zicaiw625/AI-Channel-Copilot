import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getSettings } from "../lib/settings.server";
import { buildLlmsTxt } from "../lib/llms.server";
import { hasFeature, FEATURES } from "../lib/access.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  let shopDomain = "";
  try {
    const { session } = await authenticate.admin(request);
    shopDomain = session?.shop || url.searchParams.get("shop") || "";
  } catch (authError) {
    shopDomain = url.searchParams.get("shop") || "";
    if (!shopDomain) {
      return Response.json({ ok: false, message: "Unauthorized" }, { status: 401 });
    }
  }

  const allowed = await hasFeature(shopDomain, FEATURES.DASHBOARD_FULL);
  if (!allowed) {
    return Response.json({ ok: false, message: "Upgrade required" }, { status: 403 });
  }

  const settings = await getSettings(shopDomain);
  const text = await buildLlmsTxt(shopDomain, settings, { range: "30d", topN: 20 });

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
