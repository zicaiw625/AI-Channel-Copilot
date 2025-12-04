export const applySecurityHeaders = (request: Request, responseHeaders: Headers) => {
  responseHeaders.set("X-Content-Type-Options", "nosniff");
  responseHeaders.set("Referrer-Policy", "strict-origin-when-cross-origin");

  const isProd = process.env.NODE_ENV === "production";
  
  // Shopify App Bridge requires 'unsafe-inline' and 'unsafe-eval' for proper operation
  // in embedded apps. We cannot use nonce because:
  // 1. CSP Level 2 ignores 'unsafe-inline' when nonce is present
  // 2. Shopify App Bridge dynamically injects scripts without nonce
  const csp = [
    "default-src 'self'",
    "script-src 'self' https: 'unsafe-inline' 'unsafe-eval'",
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
