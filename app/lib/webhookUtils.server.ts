/**
 * Webhook 公共工具函数
 * 提取重复的错误处理和响应逻辑
 */

import { logger } from "./logger.server";

// ============================================================================
// 可恢复错误判断
// ============================================================================

/**
 * 可恢复的错误类型（这些错误可以通过重试解决）
 */
const RECOVERABLE_ERROR_CODES = [
  "ECONNREFUSED",      // 连接被拒绝
  "ETIMEDOUT",         // 连接超时
  "ENOTFOUND",         // DNS 解析失败
  "ECONNRESET",        // 连接重置
  "EPIPE",             // 管道破裂
  "P2024",             // Prisma 连接超时
  "P2028",             // Prisma 事务超时
  "P2034",             // Prisma 事务冲突
  "SQLITE_BUSY",       // SQLite 数据库忙
  "too many connections", // 连接池耗尽
] as const;

/**
 * 判断错误是否可恢复（可通过重试解决）
 * @param error - 捕获的错误对象
 * @returns 是否可恢复
 */
export function isRecoverableError(error: Error): boolean {
  const message = error.message || "";
  const lowerMessage = message.toLowerCase();
  
  return RECOVERABLE_ERROR_CODES.some(code => 
    lowerMessage.includes(code.toLowerCase())
  );
}

// ============================================================================
// 标准化 Webhook 响应
// ============================================================================

export type WebhookResult = {
  success: boolean;
  message: string;
  shouldRetry: boolean;
};

/**
 * 创建成功响应
 */
export function webhookSuccess(message: string = "OK"): Response {
  return new Response(message, { status: 200 });
}

/**
 * 创建需要重试的错误响应 (500)
 * Shopify 会自动重试返回 5xx 的 webhook
 */
export function webhookRetryableError(message: string = "Temporary error, please retry"): Response {
  return new Response(message, { status: 500 });
}

/**
 * 创建不需要重试的错误响应 (200)
 * 返回 200 可以防止 Shopify 无限重试不可恢复的错误
 */
export function webhookNonRetryableError(message: string = "Error"): Response {
  return new Response(message, { status: 200 });
}

/**
 * 创建速率限制响应 (429)
 */
export function webhookRateLimited(): Response {
  return new Response("Rate limit exceeded", { status: 429 });
}

/**
 * 创建无效请求响应 (400)
 */
export function webhookBadRequest(message: string = "Bad request"): Response {
  return new Response(message, { status: 400 });
}

// ============================================================================
// 错误处理包装器
// ============================================================================

export type WebhookHandlerContext = {
  shop: string;
  topic: string;
  webhookType: string;
};

/**
 * 标准化的 webhook 错误处理
 * @param error - 捕获的错误
 * @param context - 上下文信息
 * @returns 适当的 HTTP 响应
 */
export function handleWebhookError(
  error: Error,
  context: WebhookHandlerContext,
): Response {
  const recoverable = isRecoverableError(error);
  
  logger.error(`[webhook] ${context.webhookType} error`, { 
    shop: context.shop,
    topic: context.topic,
  }, {
    error: error.message,
    stack: error.stack,
    recoverable,
  });
  
  // 对于可恢复的错误，返回 500 让 Shopify 重试
  if (recoverable) {
    return webhookRetryableError();
  }
  
  // 对于不可恢复的错误，返回 200 避免无限重试
  return webhookNonRetryableError();
}

// ============================================================================
// Payload 验证
// ============================================================================

/**
 * 验证 webhook payload 是否有效
 * @param payload - webhook payload
 * @param requiredFields - 必需的字段列表
 * @returns 验证结果
 */
export function validateWebhookPayload<T extends Record<string, unknown>>(
  payload: unknown,
  requiredFields: (keyof T)[],
): { valid: true; data: T } | { valid: false; error: string } {
  if (!payload || typeof payload !== "object") {
    return { valid: false, error: "Invalid payload: not an object" };
  }
  
  const data = payload as Record<string, unknown>;
  
  for (const field of requiredFields) {
    if (!(field in data) || data[field as string] === undefined || data[field as string] === null) {
      return { valid: false, error: `Invalid payload: missing required field '${String(field)}'` };
    }
  }
  
  return { valid: true, data: data as T };
}

// ============================================================================
// 日志辅助
// ============================================================================

/**
 * 记录 webhook 接收日志
 */
export function logWebhookReceived(
  webhookType: string,
  shop: string,
  topic: string,
  extra?: Record<string, unknown>,
): void {
  logger.info(`[webhook] ${webhookType} received`, { shop, topic, ...extra });
}

/**
 * 记录 webhook 处理完成日志
 */
export function logWebhookProcessed(
  webhookType: string,
  shop: string,
  extra?: Record<string, unknown>,
): void {
  logger.info(`[webhook] ${webhookType} processed`, { shop, ...extra });
}
