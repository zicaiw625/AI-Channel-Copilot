/**
 * 敏感字段白名单 - 这些字段会被保留
 * 其他未知字段如果是对象/数组会被递归处理
 */
const SAFE_FIELDS = new Set([
  // 标识符（已脱敏或非敏感）
  "shopDomain", "shop", "orderId", "orderGid", "refundId", "jobId", "jobType",
  "topic", "intent", "operation", "status", "planId", "planName",
  // 计数/度量
  "count", "total", "attempts", "retries", "durationMs", "failureRate",
  "success", "failure", "batchSize", "processed",
  // 布尔标志
  "ok", "synced", "isTrialing", "hasOrderId", "hasAdminGid", "hasData",
  // 时间戳
  "timestamp", "createdAt", "updatedAt",
  // 错误信息（message 通常安全，stack 在 dev 环境有用）
  "message", "errorType",
]);

/**
 * 敏感字段黑名单 - 这些字段会被替换为 [REDACTED]
 */
const SENSITIVE_FIELDS = new Set([
  "password", "token", "secret", "apiKey", "accessToken", "refreshToken",
  "authorization", "cookie", "session", "creditCard", "ssn", "email",
  "phone", "address", "ip", "payload", "body", "rawPayload", "webhookPayload",
  // IP 地址相关字段（GDPR/隐私合规）
  "clientIp", "clientip", "remoteAddress", "remoteaddress",
  "x-forwarded-for", "xForwardedFor", "x-real-ip", "xRealIp",
  "cf-connecting-ip", "cfConnectingIp",
  // 其他可能包含 PII 的字段
  "customerEmail", "customerPhone", "billingAddress", "shippingAddress",
  "destinationUrl", "webhookUrl", "callbackUrl",
]);

/**
 * 递归脱敏对象，保护敏感数据不被记录到日志
 */
const sanitize = (obj: unknown, depth = 0): unknown => {
  // 防止无限递归
  if (depth > 5) return "[MAX_DEPTH]";
  
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) {
    return obj.slice(0, 10).map((item) => sanitize(item, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    
    // 黑名单字段直接脱敏
    if (SENSITIVE_FIELDS.has(key) || SENSITIVE_FIELDS.has(lowerKey)) {
      result[key] = "[REDACTED]";
      continue;
    }
    
    // 白名单字段或基本类型直接保留
    if (SAFE_FIELDS.has(key) || typeof value !== "object" || value === null) {
      result[key] = value;
      continue;
    }
    
    // 其他对象递归处理
    result[key] = sanitize(value, depth + 1);
  }
  return result;
};

const appendContext = (
  context?: Record<string, unknown>,
  extra?: Record<string, unknown>,
) => {
  const merged = {
    timestamp: new Date().toISOString(),
    ...(context || {}),
    ...(extra || {}),
  };
  return sanitize(merged) as Record<string, unknown>;
};

const base = (level: "info" | "warn" | "error" | "debug") =>
  (message: string, context?: Record<string, unknown>, extra?: Record<string, unknown>) => {
    // eslint-disable-next-line no-console
    console[level](message, appendContext(context, extra));
  };

export const logger = {
  info: base("info"),
  warn: base("warn"),
  error: base("error"),
  debug: base("debug"),
};

export type LogContext = {
  shopDomain?: string;
  jobType?: string;
  jobId?: number | string;
  intent?: string;
};
