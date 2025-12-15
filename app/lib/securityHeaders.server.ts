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
 * 🔧 CSP 指令解析器：将 CSP 字符串解析为 Map
 */
const parseCSP = (csp: string): Map<string, string> => {
  const directives = new Map<string, string>();
  // 按分号分割，处理每个指令
  for (const part of csp.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    // 第一个空格分割指令名和值
    const spaceIdx = trimmed.indexOf(" ");
    if (spaceIdx === -1) {
      directives.set(trimmed.toLowerCase(), "");
    } else {
      const name = trimmed.slice(0, spaceIdx).toLowerCase();
      const value = trimmed.slice(spaceIdx + 1).trim();
      directives.set(name, value);
    }
  }
  return directives;
};

/**
 * 🔧 合并两个 CSP Map，优先保留 Shopify 的关键指令
 */
const mergeCSPDirectives = (
  shopifyCSP: Map<string, string>,
  appCSP: Map<string, string>
): string => {
  const merged = new Map<string, string>();
  
  // 先应用 app 的默认指令
  for (const [name, value] of appCSP) {
    merged.set(name, value);
  }
  
  // 🔧 保留 Shopify SDK 设置的关键指令（frame-ancestors 是必须的）
  // 同时合并 script-src 中的 nonce（如果存在）
  const preserveDirectives = ["frame-ancestors"];
  const mergeDirectives = ["script-src", "style-src", "connect-src"];
  
  for (const [name, value] of shopifyCSP) {
    if (preserveDirectives.includes(name)) {
      // 完全保留 Shopify 的值
      merged.set(name, value);
    } else if (mergeDirectives.includes(name)) {
      // 合并指令：提取 Shopify 的 nonce 并添加到 app 的指令中
      const appValue = merged.get(name) || "";
      const nonceMatch = value.match(/'nonce-[^']+'/g);
      if (nonceMatch && !appValue.includes("nonce-")) {
        // 将 nonce 添加到现有值中
        merged.set(name, `${appValue} ${nonceMatch.join(" ")}`.trim());
      }
    }
    // 其他指令使用 app 的默认值
  }
  
  // 构建最终 CSP 字符串
  return Array.from(merged.entries())
    .map(([name, value]) => value ? `${name} ${value}` : name)
    .join("; ");
};

/**
 * 生成 App 默认的 CSP 指令 Map
 * 
 * 注意：frame-ancestors 由 Shopify SDK 动态设置
 * 每个店铺需要不同的 frame-ancestors 值以通过 Shopify 审核
 */
const getDefaultAppCSP = (): Map<string, string> => {
  // Shopify App Bridge requires 'unsafe-inline' and 'unsafe-eval' for proper operation
  // in embedded apps. We cannot fully use nonce because:
  // 1. CSP Level 2 ignores 'unsafe-inline' when nonce is present
  // 2. Shopify App Bridge dynamically injects scripts without nonce
  const directives = new Map<string, string>();
  directives.set("default-src", "'self'");
  directives.set("script-src", "'self' https: 'unsafe-inline' 'unsafe-eval'");
  directives.set("style-src", "'self' 'unsafe-inline' https:");
  directives.set("img-src", "'self' data: https:");
  directives.set("font-src", "'self' https:");
  directives.set("connect-src", "'self' https: wss:");
  directives.set("object-src", "'none'");
  directives.set("base-uri", "'self'");
  directives.set("form-action", "'self' https://*.myshopify.com https://admin.shopify.com");
  return directives;
};

/**
 * 为页面响应应用安全头
 * 
 * 🔧 重要改进：此函数现在完整解析并合并 Shopify SDK 设置的 CSP
 * - 保留 Shopify 的 frame-ancestors（店铺动态值）
 * - 合并 script-src/style-src 中的 nonce（如果存在）
 * - 使用 App 的其他默认安全指令
 */
export const applySecurityHeaders = (request: Request, responseHeaders: Headers) => {
  // 应用基础安全头
  Object.entries(BASE_SECURITY_HEADERS).forEach(([key, value]) => {
    responseHeaders.set(key, value);
  });

  // 🔧 改进：完整解析并合并 CSP，而不是只提取 frame-ancestors
  const existingCSP = responseHeaders.get("Content-Security-Policy");
  const appCSP = getDefaultAppCSP();
  
  if (existingCSP) {
    // 解析 Shopify SDK 设置的 CSP
    const shopifyCSP = parseCSP(existingCSP);
    // 合并两个 CSP（保留 Shopify 的关键指令，合并 nonce）
    const mergedCSP = mergeCSPDirectives(shopifyCSP, appCSP);
    responseHeaders.set("Content-Security-Policy", mergedCSP);
  } else {
    // 如果 Shopify 没有设置 CSP，使用 App 的默认 CSP
    const defaultCSP = Array.from(appCSP.entries())
      .map(([name, value]) => value ? `${name} ${value}` : name)
      .join("; ");
    responseHeaders.set("Content-Security-Policy", defaultCSP);
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
