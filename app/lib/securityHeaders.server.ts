import crypto from "node:crypto";

const generateNonce = () => crypto.randomBytes(16).toString("base64");

export const applySecurityHeaders = (request: Request, responseHeaders: Headers) => {
  responseHeaders.set("X-Content-Type-Options", "nosniff");
  responseHeaders.set("Referrer-Policy", "strict-origin-when-cross-origin");

  const isProd = process.env.NODE_ENV === "production";
  const nonce = generateNonce();
  responseHeaders.set("X-CSP-Nonce", nonce);
  
  // Shopify App Bridge requires 'unsafe-inline' and 'unsafe-eval' for proper operation
  // in embedded apps. The nonce is still provided for scripts that can use it.
  const scriptSrc = [
    "script-src",
    "'self'",
    "https:",
    `'nonce-${nonce}'`,
    "'unsafe-inline'",
    "'unsafe-eval'"
  ];

  const csp = [
    "default-src 'self'",
    scriptSrc.join(" "),
    "style-src 'self' 'unsafe-inline' https:",
    "img-src 'self' data: https:",
    "font-src 'self' https:",
    "connect-src 'self' https: wss:",
    "object-src 'none'",
    "frame-ancestors https://*.myshopify.com https://admin.shopify.com",
    "base-uri 'self'",
    "form-action 'self' https://*.myshopify.com https://admin.shopify.com",
  ].join("; ");
  responseHeaders.set("Content-Security-Policy", csp);

  const isHttps = request.url.startsWith("https://");
  if (isProd && isHttps) {
    responseHeaders.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
};
