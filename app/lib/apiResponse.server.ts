/**
 * 统一 API 响应格式
 * 
 * 标准响应格式:
 * - 成功: { ok: true, data: T }
 * - 错误: { ok: false, error: { code: string, message: string, details?: unknown } }
 * 
 * 使用示例:
 * - 成功: return apiSuccess({ orders: [...] })
 * - 错误: return apiError("INVALID_INPUT", "Shop domain is required", 400)
 * - AppError: return apiErrorFromAppError(appError)
 */

import { applyApiSecurityHeaders } from "./securityHeaders.server";
import { AppError, ErrorCode, handleError, formatErrorForLogging } from "./errors";
import { logger } from "./logger.server";

// ============================================================================
// Types
// ============================================================================

export interface ApiSuccessResponse<T = unknown> {
  ok: true;
  data: T;
}

export interface ApiErrorResponse {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse;

// ============================================================================
// Success Response
// ============================================================================

/**
 * 创建标准成功响应
 * @param data - 响应数据
 * @param status - HTTP 状态码 (默认 200)
 * @param headers - 额外的响应头
 */
export function apiSuccess<T>(
  data: T,
  status = 200,
  headers?: HeadersInit
): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json");
  applyApiSecurityHeaders(responseHeaders);

  const body: ApiSuccessResponse<T> = {
    ok: true,
    data,
  };

  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  });
}

// ============================================================================
// Error Response
// ============================================================================

/**
 * 创建标准错误响应
 * @param code - 错误代码 (ErrorCode 枚举值)
 * @param message - 用户可读的错误消息
 * @param status - HTTP 状态码
 * @param details - 可选的详细信息
 * @param headers - 额外的响应头
 */
export function apiError(
  code: ErrorCode | string,
  message: string,
  status = 500,
  details?: unknown,
  headers?: HeadersInit
): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json");
  applyApiSecurityHeaders(responseHeaders);

  const body: ApiErrorResponse = {
    ok: false,
    error: {
      code: typeof code === "string" ? code : ErrorCode[code],
      message,
      ...(details !== undefined && { details }),
    },
  };

  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  });
}

/**
 * 从 AppError 创建标准错误响应
 * @param error - AppError 实例
 * @param headers - 额外的响应头
 */
export function apiErrorFromAppError(
  error: AppError,
  headers?: HeadersInit
): Response {
  // 记录非操作性错误
  if (!error.isOperational) {
    logger.error("[apiResponse] Non-operational error", formatErrorForLogging(error));
  }

  return apiError(
    error.code,
    error.message,
    error.statusCode,
    error.context,
    headers
  );
}

// ============================================================================
// Common Error Responses
// ============================================================================

/**
 * 400 Bad Request
 */
export function apiBadRequest(message: string, details?: unknown): Response {
  return apiError(ErrorCode.INVALID_INPUT, message, 400, details);
}

/**
 * 401 Unauthorized
 */
export function apiUnauthorized(message = "Authentication required"): Response {
  return apiError(ErrorCode.UNAUTHORIZED, message, 401);
}

/**
 * 403 Forbidden
 */
export function apiForbidden(message = "Access denied"): Response {
  return apiError(ErrorCode.FORBIDDEN, message, 403);
}

/**
 * 404 Not Found
 */
export function apiNotFound(resource = "Resource", identifier?: string): Response {
  const message = identifier
    ? `${resource} not found: ${identifier}`
    : `${resource} not found`;
  return apiError(ErrorCode.NOT_FOUND, message, 404);
}

/**
 * 429 Too Many Requests
 */
export function apiRateLimited(
  message = "Rate limit exceeded. Please try again later.",
  retryAfter?: number,
  headers?: HeadersInit
): Response {
  const responseHeaders = new Headers(headers);
  if (retryAfter) {
    responseHeaders.set("Retry-After", String(retryAfter));
  }
  return apiError(ErrorCode.RATE_LIMIT_EXCEEDED, message, 429, undefined, responseHeaders);
}

/**
 * 500 Internal Server Error
 */
export function apiInternalError(message = "Internal server error"): Response {
  return apiError(ErrorCode.INTERNAL_ERROR, message, 500);
}

/**
 * 503 Service Unavailable
 */
export function apiServiceUnavailable(message = "Service temporarily unavailable"): Response {
  return apiError(ErrorCode.EXTERNAL_SERVICE_ERROR, message, 503);
}

// ============================================================================
// Error Handler Wrapper
// ============================================================================

/**
 * 统一处理 API 路由中的错误
 * 将任何错误转换为标准 API 错误响应
 * 
 * @param error - 捕获的错误
 * @param context - 可选的上下文信息（用于日志）
 */
export function handleApiError(
  error: unknown,
  context?: Record<string, unknown>
): Response {
  // 如果已经是 AppError，直接使用
  if (error instanceof AppError) {
    return apiErrorFromAppError(error);
  }

  // 转换为 AppError
  const appError = handleError(error, context);
  
  // 记录错误
  logger.error("[apiResponse] API error", {
    ...formatErrorForLogging(appError),
    originalContext: context,
  });

  return apiErrorFromAppError(appError);
}

// ============================================================================
// Legacy Compatibility
// ============================================================================

/**
 * 兼容旧格式的简单错误响应
 * @deprecated 使用 apiError 或 apiBadRequest 代替
 */
export function legacyErrorResponse(
  error: string,
  status = 400
): Response {
  return apiError(
    status >= 500 ? ErrorCode.INTERNAL_ERROR : ErrorCode.INVALID_INPUT,
    error,
    status
  );
}

/**
 * 兼容旧格式的简单成功响应
 * @deprecated 使用 apiSuccess 代替
 */
export function legacySuccessResponse<T extends object>(
  data: T,
  status = 200
): Response {
  const responseHeaders = new Headers();
  responseHeaders.set("Content-Type", "application/json");
  applyApiSecurityHeaders(responseHeaders);

  return new Response(JSON.stringify({ ok: true, ...data }), {
    status,
    headers: responseHeaders,
  });
}
