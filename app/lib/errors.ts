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
    // Prisma错误 - 使用改进的错误处理
    if (error.name === 'PrismaClientKnownRequestError') {
      // 内联处理以避免循环依赖和 require 问题
      const prismaError = error as Error & { code?: string; meta?: Record<string, unknown> };
      const code = prismaError.code;
      const meta = prismaError.meta;
      
      // Common Prisma error codes
      const P_UNIQUE = 'P2002';
      const P_NOT_FOUND = 'P2025';
      const P_RECORD_NOT_EXIST = 'P2001';
      const P_RELATED_NOT_FOUND = 'P2015';
      const P_FOREIGN_KEY = 'P2003';
      const P_NULL_CONSTRAINT = 'P2011';
      const P_MISSING_VALUE = 'P2012';
      const P_VALUE_OUT_OF_RANGE = 'P2020';
      const P_VALUE_TOO_LONG = 'P2000';
      const P_CONNECTION_TIMEOUT = 'P2024';
      const P_TRANSACTION_CONFLICT = 'P2034';

      switch (code) {
        case P_UNIQUE:
          return new DatabaseError('Duplicate entry: a record with this value already exists', { 
            ...context, 
            prismaCode: code,
            meta,
          });
        
        case P_NOT_FOUND:
        case P_RECORD_NOT_EXIST:
        case P_RELATED_NOT_FOUND:
          return new NotFoundError('Record', context?.id as string);
        
        case P_FOREIGN_KEY:
          return new DatabaseError('Foreign key constraint failed: related record does not exist', { 
            ...context, 
            prismaCode: code,
            meta,
          });
        
        case P_NULL_CONSTRAINT:
        case P_MISSING_VALUE:
          return new ValidationError(
            'Required field is missing or null',
            meta?.target as string,
          );
        
        case P_VALUE_OUT_OF_RANGE:
        case P_VALUE_TOO_LONG:
          return new ValidationError(
            'Value is out of allowed range',
            meta?.column_name as string,
          );
        
        case P_CONNECTION_TIMEOUT:
          return new AppError(
            ErrorCode.DATABASE_ERROR,
            'Database connection timeout - please retry',
            503,
            { ...context, prismaCode: code, isRetryable: true },
            true
          );
        
        case P_TRANSACTION_CONFLICT:
          return new AppError(
            ErrorCode.DATABASE_ERROR,
            'Transaction conflict - please retry',
            409,
            { ...context, prismaCode: code, isRetryable: true },
            true
          );
        
        default:
          return new DatabaseError(error.message, { 
            ...context, 
            prismaCode: code,
            meta,
          });
      }
    }

    // Prisma 初始化错误
    if (error.name === 'PrismaClientInitializationError') {
      return new AppError(
        ErrorCode.DATABASE_ERROR,
        'Database connection failed',
        503,
        { ...context, originalError: error.name },
        false
      );
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
export const asyncErrorHandler = <T extends unknown[], R>(
  fn: (...args: T) => Promise<R>
) => {
  return async (...args: T): Promise<R> => {
    try {
      return await fn(...args);
    } catch (error) {
      throw handleError(error, { function: fn.name, args: args.slice(0, 3) }); // 只记录前3个参数避免敏感数据泄露
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
