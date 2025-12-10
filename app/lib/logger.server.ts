/**
 * 敏感字段列表 - 这些字段会被自动脱敏
 * 采用白名单 + 黑名单混合策略：
 * - 黑名单字段直接替换为 [REDACTED]
 * - 包含敏感关键词的字段也会被脱敏
 */
const SENSITIVE_FIELDS = new Set([
  "password",
  "token",
  "key",
  "secret",
  "apiKey",
  "api_key",
  "accessToken",
  "access_token",
  "refreshToken",
  "refresh_token",
  "authorization",
  "cookie",
  "session",
  "creditCard",
  "credit_card",
  "ssn",
  "email",
  "phone",
  "address",
  "ip",
  "payload", // webhook payload 不应直接打印
]);

/**
 * 敏感关键词 - 字段名包含这些词也会被脱敏
 */
const SENSITIVE_KEYWORDS = ["password", "token", "secret", "key", "auth", "credential"];

/**
 * 检查字段名是否敏感
 */
const isSensitiveField = (fieldName: string): boolean => {
  const lower = fieldName.toLowerCase();
  if (SENSITIVE_FIELDS.has(lower)) return true;
  return SENSITIVE_KEYWORDS.some((keyword) => lower.includes(keyword));
};

/**
 * 递归脱敏对象中的敏感字段
 * @param data - 需要脱敏的数据
 * @param depth - 当前递归深度（防止循环引用）
 */
const sanitize = (data: unknown, depth = 0): unknown => {
  // 防止无限递归
  if (depth > 10) return "[MAX_DEPTH]";

  if (data === null || data === undefined) return data;

  // 基本类型直接返回
  if (typeof data !== "object") return data;

  // 数组处理
  if (Array.isArray(data)) {
    return data.map((item) => sanitize(item, depth + 1));
  }

  // 对象处理
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (isSensitiveField(key)) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      sanitized[key] = sanitize(value, depth + 1);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
};

const appendContext = (
  context?: Record<string, unknown>,
  extra?: Record<string, unknown>,
) => ({
  timestamp: new Date().toISOString(),
  ...(sanitize(context || {}) as Record<string, unknown>),
  ...(sanitize(extra || {}) as Record<string, unknown>),
});

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

/**
 * 手动脱敏工具函数（供需要显式脱敏的场景使用）
 */
export const sanitizeForLogging = sanitize;
