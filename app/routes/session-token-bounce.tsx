import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireEnv } from "../lib/env.server";
import { sanitizeReloadTarget } from "../lib/sessionToken.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const reload = sanitizeReloadTarget(url.searchParams.get("shopify-reload"));

  if (!reload) {
    return new Response("Invalid bounce target", { status: 400 });
  }

  const apiKey = requireEnv("SHOPIFY_API_KEY");
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="shopify-api-key" content="${apiKey}" />
    <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
    <script>
      window.addEventListener("load", () => {
        const reload = ${JSON.stringify(reload)};
        if (reload) window.location.replace(reload);
      });
    </script>
    <title>Loading…</title>
  </head>
  <body>
    <p>Loading…</p>
  </body>
</html>`;

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
