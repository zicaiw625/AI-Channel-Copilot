import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useNonce } from "../lib/nonce";
import { isProduction } from "../lib/env.server";

// Allowed domains for redirect (Shopify-related only)
const ALLOWED_REDIRECT_DOMAINS = [
  "admin.shopify.com",
  "myshopify.com",
  "shopify.com",
];

const BILLING_CTX_COOKIE = "aicc_billing_ctx";
const SHOP_DOMAIN_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;

const isAllowedRedirectUrl = (urlString: string): boolean => {
  try {
    const parsedUrl = new URL(urlString);
    // Only allow HTTPS
    if (parsedUrl.protocol !== "https:") return false;
    // Check if domain is in allowed list
    return ALLOWED_REDIRECT_DOMAINS.some((domain) =>
      parsedUrl.hostname === domain || parsedUrl.hostname.endsWith(`.${domain}`)
    );
  } catch {
    return false;
  }
};

const readCookie = (cookieHeader: string, name: string): string | null => {
  const parts = cookieHeader.split(";").map((p) => p.trim());
  for (const part of parts) {
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    if (k !== name) continue;
    return part.slice(eq + 1);
  }
  return null;
};

const serializeCookie = (
  name: string,
  value: string,
  opts: { maxAgeSeconds?: number; expires?: Date; httpOnly?: boolean; secure?: boolean; sameSite?: "Lax" | "Strict" | "None"; path?: string },
) => {
  const enc = encodeURIComponent(value);
  const parts = [`${name}=${enc}`];
  if (opts.maxAgeSeconds !== undefined) parts.push(`Max-Age=${opts.maxAgeSeconds}`);
  if (opts.expires) parts.push(`Expires=${opts.expires.toUTCString()}`);
  parts.push(`Path=${opts.path || "/"}`);
  if (opts.httpOnly) parts.push("HttpOnly");
  if (opts.secure) parts.push("Secure");
  if (opts.sameSite) parts.push(`SameSite=${opts.sameSite}`);
  return parts.join("; ");
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const to = url.searchParams.get("to") || "";
  if (!to) {
    return new Response("Missing 'to' parameter", { status: 400 });
  }
  // Validate redirect URL to prevent open redirect attacks
  if (!isAllowedRedirectUrl(to)) {
    return new Response("Invalid redirect target", { status: 400 });
  }

  // IMPORTANT:
  // Shopify approve 回跳时可能不会保留 returnUrl 的 query（不同确认页/策略会导致参数缺失）。
  // 这里在跳往 Shopify 确认页前，把 shop/host 等写入短期 HttpOnly cookie，
  // 以便 /app/billing/confirm 缺参时能恢复上下文，避免走到 /auth/login(生产 404)。
  const shop = url.searchParams.get("shop") || "";
  const host = url.searchParams.get("host") || "";
  const embedded = url.searchParams.get("embedded") || "";
  const locale = url.searchParams.get("locale") || "";

  let setCookie: string | null = null;
  if (shop && SHOP_DOMAIN_REGEX.test(shop)) {
    const ctx = new URLSearchParams();
    ctx.set("shop", shop);
    if (host) ctx.set("host", host);
    if (embedded) ctx.set("embedded", embedded);
    if (locale) ctx.set("locale", locale);

    // Avoid overwriting an existing ctx that matches (reduce churn)
    const existing = readCookie(request.headers.get("Cookie") || "", BILLING_CTX_COOKIE);
    if (!existing || decodeURIComponent(existing) !== ctx.toString()) {
      setCookie = serializeCookie(BILLING_CTX_COOKIE, ctx.toString(), {
        maxAgeSeconds: 10 * 60, // 10 minutes
        httpOnly: true,
        secure: isProduction(),
        sameSite: "Lax",
        path: "/",
      });
    }
  }

  if (setCookie) {
    return Response.json({ to }, { headers: { "Set-Cookie": setCookie } });
  }
  return Response.json({ to });
};

export default function Redirect() {
  const { to } = useLoaderData<typeof loader>();
  const nonce = useNonce();
  return (
    <div style={{ padding: 20, fontFamily: "system-ui" }}>
      <p style={{ marginBottom: 12 }}>正在跳转到 Shopify 确认页面…</p>
      <a href={to} target="_top" rel="noopener noreferrer">如果没有自动跳转，请点击这里</a>
      <script
        nonce={nonce}
        dangerouslySetInnerHTML={{ __html: `window.top.location.href = ${JSON.stringify(to)};` }}
      />
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
