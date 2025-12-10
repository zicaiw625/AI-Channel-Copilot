/**
 * 敏感字段列表 - 这些字段会在日志中被脱敏
 */
const SENSITIVE_FIELDS = new Set([
  "password", "token", "key", "secret", "apiKey", "accessToken",
  "authorization", "cookie", "session", "creditCard", "ssn",
  "email", "phone", "address", "ip", "payload", "body",
  "customer", "billing_address", "shipping_address",
]);

/**
 * 递归脱敏对象中的敏感字段
 * 采用白名单策略：只保留安全字段的原始值
 */
const sanitizeForLogging = (data: unknown, depth = 0): unknown => {
  // 防止无限递归
  if (depth > 5) return "[MAX_DEPTH]";
  
  if (data === null || data === undefined) return data;
  
  if (typeof data !== "object") {
    // 字符串长度限制，防止意外打印大量数据
    if (typeof data === "string" && data.length > 500) {
      return data.slice(0, 100) + `...[${data.length} chars]`;
    }
    return data;
  }
  
  if (Array.isArray(data)) {
    // 数组长度限制
    const limited = data.slice(0, 10);
    const sanitized = limited.map((item) => sanitizeForLogging(item, depth + 1));
    if (data.length > 10) {
      sanitized.push(`...[${data.length - 10} more]`);
    }
    return sanitized;
  }
  
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    
    // 检查是否为敏感字段
    if (SENSITIVE_FIELDS.has(lowerKey) || 
        lowerKey.includes("token") || 
        lowerKey.includes("secret") ||
        lowerKey.includes("password") ||
        lowerKey.includes("email") ||
        lowerKey.includes("phone")) {
      sanitized[key] = "[REDACTED]";
    } else {
      sanitized[key] = sanitizeForLogging(value, depth + 1);
    }
  }
  
  return sanitized;
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
  // 对所有日志上下文进行脱敏处理
  return sanitizeForLogging(merged) as Record<string, unknown>;
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

// 导出脱敏函数供其他模块使用
export { sanitizeForLogging };
