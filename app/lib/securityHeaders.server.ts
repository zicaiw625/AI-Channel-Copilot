export const applySecurityHeaders = (request: Request, responseHeaders: Headers) => {
  responseHeaders.set("X-Content-Type-Options", "nosniff");
  responseHeaders.set("Referrer-Policy", "strict-origin-when-cross-origin");

  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:",
    "style-src 'self' 'unsafe-inline' https:",
    "img-src 'self' data: https:",
    "font-src 'self' https:",
    "connect-src 'self' https: wss:",
    "frame-ancestors https://*.myshopify.com https://admin.shopify.com",
    "base-uri 'self'",
    "form-action 'self' https://*.myshopify.com https://admin.shopify.com",
  ].join("; ");
  responseHeaders.set("Content-Security-Policy", csp);

  responseHeaders.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
};
