/**
 * 统一错误处理和自定义错误类型
 */

export enum ErrorCode {
  // 数据库相关错误
  DATABASE_ERROR = 'DATABASE_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  DUPLICATE_ENTRY = 'DUPLICATE_ENTRY',

  // 认证和授权错误
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  INVALID_SESSION = 'INVALID_SESSION',

  // 业务逻辑错误
  INVALID_INPUT = 'INVALID_INPUT',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  BUSINESS_RULE_VIOLATION = 'BUSINESS_RULE_VIOLATION',

  // 外部服务错误
  SHOPIFY_API_ERROR = 'SHOPIFY_API_ERROR',
  EXTERNAL_SERVICE_ERROR = 'EXTERNAL_SERVICE_ERROR',

  // 系统错误
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  CONFIGURATION_ERROR = 'CONFIGURATION_ERROR',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
}

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly context?: Record<string, unknown>;
  public readonly isOperational: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    statusCode: number = 500,
    context?: Record<string, unknown>,
    isOperational: boolean = true
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.context = context;
    this.isOperational = isOperational;

    // 保持正确的堆栈跟踪
    Error.captureStackTrace(this, this.constructor);
  }
}

export class DatabaseError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(ErrorCode.DATABASE_ERROR, message, 500, context);
    this.name = 'DatabaseError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, identifier?: string | number) {
    super(
      ErrorCode.NOT_FOUND,
      `${resource} not found${identifier ? `: ${identifier}` : ''}`,
      404,
      { resource, identifier }
    );
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string, field?: string, value?: unknown) {
    super(
      ErrorCode.VALIDATION_ERROR,
      message,
      400,
      { field, value }
    );
    this.name = 'ValidationError';
  }
}

export class ShopifyApiError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(ErrorCode.SHOPIFY_API_ERROR, message, 502, context);
    this.name = 'ShopifyApiError';
  }
}

/**
 * 错误处理工具函数
 */
export const handleError = (error: unknown, context?: Record<string, unknown>): AppError => {
  // 如果已经是AppError，直接返回
  if (error instanceof AppError) {
    return error;
  }

  // 处理已知错误类型
  if (error instanceof Error) {
    // Prisma错误
    if (error.name === 'PrismaClientKnownRequestError') {
      const prismaError = error as any;
      switch (prismaError.code) {
        case 'P2002':
          return new DatabaseError('Duplicate entry', { ...context, prismaCode: prismaError.code });
        case 'P2025':
          return new NotFoundError('Record', context?.id as string);
        default:
          return new DatabaseError(error.message, { ...context, prismaCode: prismaError.code });
      }
    }

    // 其他已知错误类型可以在这里添加
    return new AppError(
      ErrorCode.INTERNAL_ERROR,
      error.message,
      500,
      { ...context, originalError: error.name },
      false
    );
  }

  // 未知错误
  return new AppError(
    ErrorCode.INTERNAL_ERROR,
    'An unknown error occurred',
    500,
    { ...context, originalError: String(error) },
    false
  );
};

/**
 * 异步错误包装器
 */
export const asyncErrorHandler = <T extends any[], R>(
  fn: (...args: T) => Promise<R>
) => {
  return async (...args: T): Promise<R> => {
    try {
      return await fn(...args);
    } catch (error) {
      throw handleError(error, { function: fn.name, args });
    }
  };
};

/**
 * 格式化错误用于日志记录
 */
export const formatErrorForLogging = (error: AppError): Record<string, unknown> => {
  return {
    name: error.name,
    code: error.code,
    message: error.message,
    statusCode: error.statusCode,
    context: error.context,
    stack: error.stack,
    isOperational: error.isOperational,
  };
};
