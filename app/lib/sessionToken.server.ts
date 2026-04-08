import { requireEnv } from "./env.server";

const APP_ORIGIN = new URL(requireEnv("SHOPIFY_APP_URL")).origin;
const BOUNCE_PATH = "/session-token-bounce";
export const INVALID_SESSION_RETRY_HEADER = "X-Shopify-Retry-Invalid-Session-Request";

export function isBrowserAuthRequest(request: Request): boolean {
  return Boolean(request.headers.get("authorization"));
}

export function invalidSessionRetryResponse(message = "Unauthorized") {
  return new Response(message, {
    status: 401,
    headers: {
      "Cache-Control": "no-store",
      [INVALID_SESSION_RETRY_HEADER]: "1",
    },
  });
}

export function sanitizeReloadTarget(reload: string | null): string | null {
  if (!reload) return null;

  try {
    const parsed = new URL(reload, APP_ORIGIN);
    if (parsed.origin !== APP_ORIGIN) return null;
    parsed.searchParams.delete("id_token");
    return parsed.toString();
  } catch {
    return null;
  }
}

export function buildSessionTokenBounceUrl(requestUrl: string | URL): string {
  const incoming = new URL(requestUrl.toString());
  const original = new URL(incoming.pathname + incoming.search, APP_ORIGIN);

  original.searchParams.delete("id_token");
  original.searchParams.delete("shopify-reload");

  const bounce = new URL(BOUNCE_PATH, APP_ORIGIN);
  for (const [key, value] of original.searchParams.entries()) {
    bounce.searchParams.set(key, value);
  }
  bounce.searchParams.set("shopify-reload", original.toString());

  return bounce.toString();
}
