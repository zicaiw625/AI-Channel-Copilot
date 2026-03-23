import prisma from "../db.server";
import { logger } from "./logger.server";
import { Prisma } from "@prisma/client";

export type LockAcquisitionResult = {
  acquired: boolean;
  reason?: "already_held" | "db_error";
};

const DEFAULT_LOCK_TRANSACTION_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * 使用 PostgreSQL transaction-scoped advisory lock 执行互斥操作
 * 
 * @param key - 锁的标识符（整数）
 * @param fn - 获取锁后要执行的函数
 * @param options - 配置选项
 * @returns 执行结果或 undefined（如果未获取到锁）
 * 
 * 注意：
 * - 如果锁已被其他进程持有，默认会跳过执行（不阻塞）
 * - 如果数据库连接失败，会根据 fallbackOnError 决定是否执行
 */
export const withAdvisoryLock = async <T = void>(
  key: number, 
  fn: () => Promise<T>,
  options: {
    /** 数据库错误时是否仍执行函数（默认 false，更安全） */
    fallbackOnError?: boolean;
    /** 锁获取超时毫秒数（默认不超时，使用 try_advisory_lock） */
    timeoutMs?: number;
  } = {}
): Promise<{ result?: T; lockInfo: LockAcquisitionResult }> => {
  const { fallbackOnError = false, timeoutMs } = options;
  
  try {
    return await prisma.$transaction(
      async (tx) => {
        let acquired = false;

        if (timeoutMs && timeoutMs > 0) {
          await tx.$executeRaw`SET LOCAL statement_timeout = ${timeoutMs}`;
          try {
            await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${key})`);
            acquired = true;
          } catch {
            acquired = false;
          }
        } else {
          const result = await tx.$queryRaw<{ locked: boolean }[]>(
            Prisma.sql`SELECT pg_try_advisory_xact_lock(${key}) AS locked`,
          );
          acquired = result[0]?.locked === true;
        }

        if (!acquired) {
          logger.debug("[locks] lock not acquired (held by another process)", { key });
          return { lockInfo: { acquired: false, reason: "already_held" as const } };
        }

        const result = await fn();
        return { result, lockInfo: { acquired: true } };
      },
      {
        timeout: Math.max(DEFAULT_LOCK_TRANSACTION_TIMEOUT_MS, timeoutMs ?? 0),
      },
    );
  } catch (error) {
    const message = (error as Error).message || "Unknown error";
    logger.error("[locks] advisory lock operation failed", { key }, { message });
    
    if (fallbackOnError) {
      // 危险：在无法确认锁状态时执行，可能导致并发问题
      logger.warn("[locks] executing without lock (fallbackOnError=true)", { key });
      const result = await fn();
      return { result, lockInfo: { acquired: false, reason: "db_error" } };
    }
    
    // 默认：不执行，返回失败状态
    return { lockInfo: { acquired: false, reason: "db_error" } };
  }
};

/**
 * 简化版本：与旧 API 兼容，但不再在错误时执行
 */
export const withAdvisoryLockSimple = async (
  key: number, 
  fn: () => Promise<void>
): Promise<void> => {
  const { lockInfo } = await withAdvisoryLock(key, fn, { fallbackOnError: false });
  if (!lockInfo.acquired) {
    logger.debug("[locks] skipped execution (lock not acquired)", { key, reason: lockInfo.reason });
  }
};
