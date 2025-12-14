/**
 * 基础安全头 - 适用于所有响应
 */
const BASE_SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-XSS-Protection": "1; mode=block",
  // X-Frame-Options for legacy browser support (CSP frame-ancestors is the modern approach)
  // Note: ALLOW-FROM is deprecated, but we set SAMEORIGIN as fallback
  // The primary protection comes from CSP frame-ancestors directive
  "X-Frame-Options": "SAMEORIGIN",
};

/**
 * API 特定安全头
 */
const API_SECURITY_HEADERS: Record<string, string> = {
  ...BASE_SECURITY_HEADERS,
  // 防止 API 响应被缓存
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  "Pragma": "no-cache",
  "Expires": "0",
};

/**
 * 生成 CSP 策略字符串
 */
const generateCSP = (): string => {
  // Shopify App Bridge requires 'unsafe-inline' and 'unsafe-eval' for proper operation
  // in embedded apps. We cannot use nonce because:
  // 1. CSP Level 2 ignores 'unsafe-inline' when nonce is present
  // 2. Shopify App Bridge dynamically injects scripts without nonce
  return [
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
};

/**
 * 为页面响应应用安全头
 */
export const applySecurityHeaders = (request: Request, responseHeaders: Headers) => {
  // 应用基础安全头
  Object.entries(BASE_SECURITY_HEADERS).forEach(([key, value]) => {
    responseHeaders.set(key, value);
  });

  // 应用 CSP
  responseHeaders.set("Content-Security-Policy", generateCSP());

  // 生产环境 HTTPS 启用 HSTS
  const isProd = process.env.NODE_ENV === "production";
  const isHttps = request.url.startsWith("https://");
  if (isProd && isHttps) {
    responseHeaders.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
};

/**
 * 为 API 响应应用安全头
 * @param responseHeaders - 响应头对象
 * @param options - 可选配置
 */
export const applyApiSecurityHeaders = (
  responseHeaders: Headers,
  options?: {
    allowCache?: boolean;
    maxAge?: number;
  }
) => {
  // 应用 API 安全头
  Object.entries(API_SECURITY_HEADERS).forEach(([key, value]) => {
    responseHeaders.set(key, value);
  });

  // 如果允许缓存，覆盖缓存头
  if (options?.allowCache && options.maxAge) {
    responseHeaders.set("Cache-Control", `public, max-age=${options.maxAge}`);
    responseHeaders.delete("Pragma");
    responseHeaders.delete("Expires");
  }

  // 生产环境启用 HSTS
  if (process.env.NODE_ENV === "production") {
    responseHeaders.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
};

/**
 * 创建带安全头的 JSON 响应
 */
export const secureJsonResponse = <T>(
  data: T,
  init?: ResponseInit & { allowCache?: boolean; maxAge?: number }
): Response => {
  const headers = new Headers(init?.headers);
  
  // 设置 Content-Type
  headers.set("Content-Type", "application/json");
  
  // 应用安全头
  applyApiSecurityHeaders(headers, {
    allowCache: init?.allowCache,
    maxAge: init?.maxAge,
  });

  return new Response(JSON.stringify(data), {
    ...init,
    headers,
  });
};

/**
 * 创建带安全头的错误响应
 */
export const secureErrorResponse = (
  message: string,
  status: number = 500,
  additionalData?: Record<string, unknown>
): Response => {
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  applyApiSecurityHeaders(headers);

  return new Response(
    JSON.stringify({
      ok: false,
      error: message,
      ...additionalData,
    }),
    { status, headers }
  );
};
