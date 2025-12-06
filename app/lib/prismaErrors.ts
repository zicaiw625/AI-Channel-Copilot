/**
 * Prisma 错误处理工具模块
 * 统一处理 Prisma 数据库操作中的常见错误
 */

import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";

/**
 * Prisma 错误代码常量 - 完整列表
 * @see https://www.prisma.io/docs/reference/api-reference/error-reference
 */
export const PRISMA_ERROR_CODES = {
  // ============================================================================
  // 常见查询引擎错误 (P2xxx)
  // ============================================================================
  
  /** P2000 - 值超出列类型允许的范围 */
  VALUE_TOO_LONG: "P2000",
  /** P2001 - 查询条件中引用的记录不存在 */
  RECORD_NOT_EXIST: "P2001",
  /** P2002 - 唯一约束冲突 */
  UNIQUE_CONSTRAINT: "P2002",
  /** P2003 - 外键约束失败 */
  FOREIGN_KEY_CONSTRAINT: "P2003",
  /** P2004 - 数据库约束失败 */
  CONSTRAINT_FAILED: "P2004",
  /** P2005 - 存储的值对字段类型无效 */
  INVALID_VALUE: "P2005",
  /** P2006 - 提供的值对字段类型无效 */
  INVALID_PROVIDED_VALUE: "P2006",
  /** P2007 - 数据验证错误 */
  DATA_VALIDATION_ERROR: "P2007",
  /** P2008 - 查询解析失败 */
  QUERY_PARSE_FAILED: "P2008",
  /** P2009 - 查询验证失败 */
  QUERY_VALIDATION_FAILED: "P2009",
  /** P2010 - 原始查询失败 */
  RAW_QUERY_FAILED: "P2010",
  /** P2011 - 非空约束冲突 */
  NULL_CONSTRAINT: "P2011",
  /** P2012 - 缺少必填值 */
  MISSING_REQUIRED_VALUE: "P2012",
  /** P2013 - 缺少必填参数 */
  MISSING_REQUIRED_ARG: "P2013",
  /** P2014 - 嵌套写入中关系冲突 */
  RELATION_VIOLATION: "P2014",
  /** P2015 - 找不到相关记录 */
  RELATED_RECORD_NOT_FOUND: "P2015",
  /** P2016 - 查询解释错误 */
  QUERY_INTERPRETATION_ERROR: "P2016",
  /** P2017 - 模型之间关系记录未连接 */
  RECORDS_NOT_CONNECTED: "P2017",
  /** P2018 - 缺少必需的连接记录 */
  REQUIRED_CONNECTED_RECORDS_MISSING: "P2018",
  /** P2019 - 输入错误 */
  INPUT_ERROR: "P2019",
  /** P2020 - 值超出范围 */
  VALUE_OUT_OF_RANGE: "P2020",
  /** P2021 - 表不存在 */
  TABLE_MISSING: "P2021",
  /** P2022 - 列不存在 */
  COLUMN_MISSING: "P2022",
  /** P2023 - 列数据不一致 */
  INCONSISTENT_COLUMN_DATA: "P2023",
  /** P2024 - 连接池超时 */
  CONNECTION_POOL_TIMEOUT: "P2024",
  /** P2025 - 记录未找到（所需操作的记录不存在） */
  NOT_FOUND: "P2025",
  /** P2026 - 数据库不支持当前查询 */
  UNSUPPORTED_QUERY: "P2026",
  /** P2027 - 查询执行期间数据库发生多个错误 */
  MULTIPLE_ERRORS: "P2027",
  /** P2028 - 事务 API 错误 */
  TRANSACTION_API_ERROR: "P2028",
  /** P2030 - 无法找到全文索引 */
  FULLTEXT_INDEX_NOT_FOUND: "P2030",
  /** P2031 - Prisma 需要启用 MongoDB 副本集以支持事务 */
  MONGODB_REPLICA_SET_REQUIRED: "P2031",
  /** P2033 - 查询中的数字溢出 */
  NUMBER_OVERFLOW: "P2033",
  /** P2034 - 事务冲突或死锁，请重试 */
  TRANSACTION_CONFLICT: "P2034",
  
  // ============================================================================
  // 迁移引擎错误 (P3xxx)
  // ============================================================================
  
  /** P3000 - 创建数据库失败 */
  DATABASE_CREATION_FAILED: "P3000",
  /** P3001 - 迁移可能导致数据丢失 */
  MIGRATION_DATA_LOSS: "P3001",
  /** P3002 - 迁移已回滚 */
  MIGRATION_ROLLED_BACK: "P3002",
  
  // ============================================================================
  // 内省引擎错误 (P4xxx)  
  // ============================================================================
  
  /** P4000 - 内省操作失败 */
  INTROSPECTION_FAILED: "P4000",
  /** P4001 - 数据库为空 */
  INTROSPECTED_DATABASE_EMPTY: "P4001",
  /** P4002 - 所选数据库模式不一致 */
  INCONSISTENT_SCHEMA: "P4002",
} as const;

/**
 * Prisma 错误代码类型
 */
export type PrismaErrorCode = typeof PRISMA_ERROR_CODES[keyof typeof PRISMA_ERROR_CODES];

/**
 * 检查是否为 Prisma 已知请求错误
 */
export const isPrismaError = (error: unknown): error is PrismaClientKnownRequestError =>
  error instanceof PrismaClientKnownRequestError;

/**
 * 检查是否为特定 Prisma 错误码
 */
export const isPrismaErrorCode = (error: unknown, code: PrismaErrorCode): boolean =>
  isPrismaError(error) && error.code === code;

/**
 * 检查是否为表不存在错误
 */
export const isTableMissing = (error: unknown): boolean =>
  isPrismaErrorCode(error, PRISMA_ERROR_CODES.TABLE_MISSING);

/**
 * 检查是否为列不存在错误
 */
export const isColumnMissing = (error: unknown): boolean =>
  isPrismaErrorCode(error, PRISMA_ERROR_CODES.COLUMN_MISSING);

/**
 * 检查是否为记录未找到错误
 */
export const isNotFound = (error: unknown): boolean =>
  isPrismaErrorCode(error, PRISMA_ERROR_CODES.NOT_FOUND);

/**
 * 检查是否为唯一约束冲突错误
 */
export const isUniqueConstraintViolation = (error: unknown): boolean =>
  isPrismaErrorCode(error, PRISMA_ERROR_CODES.UNIQUE_CONSTRAINT);

/**
 * 检查是否为外键约束错误
 */
export const isForeignKeyConstraintError = (error: unknown): boolean =>
  isPrismaErrorCode(error, PRISMA_ERROR_CODES.FOREIGN_KEY_CONSTRAINT);

/**
 * 检查是否为连接池超时错误
 */
export const isConnectionPoolTimeout = (error: unknown): boolean =>
  isPrismaErrorCode(error, PRISMA_ERROR_CODES.CONNECTION_POOL_TIMEOUT);

/**
 * 检查是否为事务冲突/死锁错误（可重试）
 */
export const isTransactionConflict = (error: unknown): boolean =>
  isPrismaErrorCode(error, PRISMA_ERROR_CODES.TRANSACTION_CONFLICT);

/**
 * 检查是否为值超出范围错误
 */
export const isValueOutOfRange = (error: unknown): boolean =>
  isPrismaErrorCode(error, PRISMA_ERROR_CODES.VALUE_OUT_OF_RANGE) ||
  isPrismaErrorCode(error, PRISMA_ERROR_CODES.VALUE_TOO_LONG);

/**
 * 检查是否为非空约束冲突
 */
export const isNullConstraintViolation = (error: unknown): boolean =>
  isPrismaErrorCode(error, PRISMA_ERROR_CODES.NULL_CONSTRAINT);

/**
 * 检查是否为架构相关错误（表或列不存在）
 * 常用于处理数据库迁移期间的兼容性问题
 */
export const isSchemaMissing = (error: unknown): boolean =>
  isTableMissing(error) || isColumnMissing(error);

/**
 * 检查是否为可忽略的迁移相关错误
 * 包括表/列不存在和记录未找到
 */
export const isIgnorableMigrationError = (error: unknown): boolean =>
  isSchemaMissing(error) || isNotFound(error);

/**
 * 检查是否为可重试的错误
 * 包括事务冲突、连接池超时等
 */
export const isRetryableError = (error: unknown): boolean =>
  isTransactionConflict(error) || isConnectionPoolTimeout(error);

/**
 * 检查是否为数据库初始化错误（例如连接失败）
 */
export const isInitializationError = (error: unknown): boolean => {
  const name = (error as Error & { name?: string })?.name || 
               (error as { constructor?: { name?: string } })?.constructor?.name;
  return String(name) === "PrismaClientInitializationError";
};

/**
 * 检查是否为验证错误（输入数据问题）
 */
export const isValidationError = (error: unknown): boolean =>
  isPrismaErrorCode(error, PRISMA_ERROR_CODES.DATA_VALIDATION_ERROR) ||
  isPrismaErrorCode(error, PRISMA_ERROR_CODES.INVALID_VALUE) ||
  isPrismaErrorCode(error, PRISMA_ERROR_CODES.INVALID_PROVIDED_VALUE) ||
  isPrismaErrorCode(error, PRISMA_ERROR_CODES.MISSING_REQUIRED_VALUE) ||
  isPrismaErrorCode(error, PRISMA_ERROR_CODES.MISSING_REQUIRED_ARG);

/**
 * Prisma 错误详情接口
 */
export interface PrismaErrorDetails {
  code: PrismaErrorCode | string | null;
  message: string;
  meta: Record<string, unknown> | null;
  isRetryable: boolean;
  httpStatus: number;
  userMessage: string;
}

/**
 * 获取 Prisma 错误的详细信息（增强版）
 */
export const getPrismaErrorDetails = (error: unknown): PrismaErrorDetails => {
  if (!isPrismaError(error)) {
    return {
      code: null,
      message: error instanceof Error ? error.message : String(error),
      meta: null,
      isRetryable: false,
      httpStatus: 500,
      userMessage: "An unexpected error occurred",
    };
  }

  const code = error.code as PrismaErrorCode;
  const meta = error.meta as Record<string, unknown> | null;
  
  // 根据错误码确定 HTTP 状态码和用户消息
  let httpStatus = 500;
  let userMessage = "A database error occurred";
  let isRetryable = false;

  switch (code) {
    case PRISMA_ERROR_CODES.NOT_FOUND:
    case PRISMA_ERROR_CODES.RECORD_NOT_EXIST:
    case PRISMA_ERROR_CODES.RELATED_RECORD_NOT_FOUND:
      httpStatus = 404;
      userMessage = "The requested record was not found";
      break;

    case PRISMA_ERROR_CODES.UNIQUE_CONSTRAINT:
      httpStatus = 409;
      userMessage = "A record with this value already exists";
      break;

    case PRISMA_ERROR_CODES.FOREIGN_KEY_CONSTRAINT:
      httpStatus = 400;
      userMessage = "The operation violates a foreign key constraint";
      break;

    case PRISMA_ERROR_CODES.NULL_CONSTRAINT:
    case PRISMA_ERROR_CODES.MISSING_REQUIRED_VALUE:
    case PRISMA_ERROR_CODES.MISSING_REQUIRED_ARG:
      httpStatus = 400;
      userMessage = "A required field is missing";
      break;

    case PRISMA_ERROR_CODES.VALUE_OUT_OF_RANGE:
    case PRISMA_ERROR_CODES.VALUE_TOO_LONG:
    case PRISMA_ERROR_CODES.NUMBER_OVERFLOW:
      httpStatus = 400;
      userMessage = "A value is out of the allowed range";
      break;

    case PRISMA_ERROR_CODES.DATA_VALIDATION_ERROR:
    case PRISMA_ERROR_CODES.INVALID_VALUE:
    case PRISMA_ERROR_CODES.INVALID_PROVIDED_VALUE:
    case PRISMA_ERROR_CODES.INPUT_ERROR:
      httpStatus = 400;
      userMessage = "The provided data is invalid";
      break;

    case PRISMA_ERROR_CODES.CONNECTION_POOL_TIMEOUT:
      httpStatus = 503;
      userMessage = "Database is temporarily unavailable";
      isRetryable = true;
      break;

    case PRISMA_ERROR_CODES.TRANSACTION_CONFLICT:
      httpStatus = 409;
      userMessage = "A conflict occurred, please retry";
      isRetryable = true;
      break;

    case PRISMA_ERROR_CODES.TABLE_MISSING:
    case PRISMA_ERROR_CODES.COLUMN_MISSING:
      httpStatus = 500;
      userMessage = "Database schema is not properly configured";
      break;

    default:
      httpStatus = 500;
      userMessage = "A database error occurred";
  }

  return {
    code,
    message: error.message,
    meta,
    isRetryable,
    httpStatus,
    userMessage,
  };
};

/**
 * 将 Prisma 错误转换为可序列化的日志对象
 */
export const serializePrismaError = (error: unknown): Record<string, unknown> => {
  const details = getPrismaErrorDetails(error);
  return {
    type: "PrismaError",
    code: details.code,
    message: details.message,
    meta: details.meta,
    httpStatus: details.httpStatus,
    isRetryable: details.isRetryable,
    stack: error instanceof Error ? error.stack : undefined,
  };
};
