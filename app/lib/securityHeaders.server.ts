/**
 * 基础安全头 - 适用于所有响应
 * 
 * 注意：不设置 X-Frame-Options 和 CSP frame-ancestors
 * 这些由 Shopify SDK 的 addDocumentResponseHeaders 动态设置
 * 以确保每个店铺的 frame-ancestors 是动态的（Shopify 审核要求）
 */
const BASE_SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-XSS-Protection": "1; mode=block",
  // 不设置 X-Frame-Options - 由 Shopify SDK 处理
  // X-Frame-Options: SAMEORIGIN 会阻止 Shopify Admin 嵌入 iframe
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
 * 生成额外的 CSP 指令（不包含 frame-ancestors）
 * 
 * 注意：frame-ancestors 由 Shopify SDK 动态设置
 * 每个店铺需要不同的 frame-ancestors 值以通过 Shopify 审核
 */
const generateAdditionalCSP = (): string => {
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
    // frame-ancestors 不在这里设置 - 由 Shopify SDK 处理
    "base-uri 'self'",
    "form-action 'self' https://*.myshopify.com https://admin.shopify.com",
  ].join("; ");
};

/**
 * 为页面响应应用安全头
 * 
 * 重要：此函数应在 Shopify SDK 的 addDocumentResponseHeaders 之后调用
 * 它会合并 CSP 而不是覆盖，保留 Shopify 设置的 frame-ancestors
 */
export const applySecurityHeaders = (request: Request, responseHeaders: Headers) => {
  // 应用基础安全头
  Object.entries(BASE_SECURITY_HEADERS).forEach(([key, value]) => {
    responseHeaders.set(key, value);
  });

  // 合并 CSP：保留 Shopify SDK 设置的 frame-ancestors，追加其他指令
  const existingCSP = responseHeaders.get("Content-Security-Policy");
  const additionalCSP = generateAdditionalCSP();
  
  if (existingCSP) {
    // 提取现有 CSP 中的 frame-ancestors（Shopify 动态设置）
    const frameAncestorsMatch = existingCSP.match(/frame-ancestors\s+[^;]+/);
    const frameAncestors = frameAncestorsMatch ? frameAncestorsMatch[0] : null;
    
    // 合并：使用我们的指令 + Shopify 的 frame-ancestors
    if (frameAncestors) {
      responseHeaders.set("Content-Security-Policy", `${additionalCSP}; ${frameAncestors}`);
    } else {
      // 如果没有 frame-ancestors，直接使用我们的 CSP
      responseHeaders.set("Content-Security-Policy", additionalCSP);
    }
  } else {
    responseHeaders.set("Content-Security-Policy", additionalCSP);
  }

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
