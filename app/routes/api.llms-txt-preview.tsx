import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getSettings } from "../lib/settings.server";
import { buildLlmsTxt } from "../lib/llms.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session?.shop || "";
  const settings = await getSettings(shopDomain);
  const text = await buildLlmsTxt(shopDomain, settings, { range: "30d", topN: 20 });

  const url = new URL(request.url);
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

