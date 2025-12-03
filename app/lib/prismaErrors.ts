/**
 * Prisma 错误处理工具模块
 * 统一处理 Prisma 数据库操作中的常见错误
 */

import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";

/**
 * Prisma 错误代码常量
 */
export const PRISMA_ERROR_CODES = {
  /** 表不存在 */
  TABLE_MISSING: "P2021",
  /** 列不存在 */
  COLUMN_MISSING: "P2022",
  /** 记录未找到 */
  NOT_FOUND: "P2025",
  /** 唯一约束冲突 */
  UNIQUE_CONSTRAINT: "P2002",
  /** 外键约束失败 */
  FOREIGN_KEY_CONSTRAINT: "P2003",
} as const;

/**
 * 检查是否为 Prisma 已知请求错误
 */
export const isPrismaError = (error: unknown): error is PrismaClientKnownRequestError =>
  error instanceof PrismaClientKnownRequestError;

/**
 * 检查是否为表不存在错误
 */
export const isTableMissing = (error: unknown): boolean =>
  isPrismaError(error) && error.code === PRISMA_ERROR_CODES.TABLE_MISSING;

/**
 * 检查是否为列不存在错误
 */
export const isColumnMissing = (error: unknown): boolean =>
  isPrismaError(error) && error.code === PRISMA_ERROR_CODES.COLUMN_MISSING;

/**
 * 检查是否为记录未找到错误
 */
export const isNotFound = (error: unknown): boolean =>
  isPrismaError(error) && error.code === PRISMA_ERROR_CODES.NOT_FOUND;

/**
 * 检查是否为唯一约束冲突错误
 */
export const isUniqueConstraintViolation = (error: unknown): boolean =>
  isPrismaError(error) && error.code === PRISMA_ERROR_CODES.UNIQUE_CONSTRAINT;

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
 * 检查是否为数据库初始化错误（例如连接失败）
 */
export const isInitializationError = (error: unknown): boolean => {
  const name = (error as any)?.name || (error as any)?.constructor?.name;
  return String(name) === "PrismaClientInitializationError";
};

/**
 * 获取 Prisma 错误的详细信息
 */
export const getPrismaErrorDetails = (error: unknown): {
  code: string | null;
  message: string;
  meta: Record<string, unknown> | null;
} => {
  if (!isPrismaError(error)) {
    return {
      code: null,
      message: error instanceof Error ? error.message : String(error),
      meta: null,
    };
  }

  return {
    code: error.code,
    message: error.message,
    meta: error.meta as Record<string, unknown> | null,
  };
};
