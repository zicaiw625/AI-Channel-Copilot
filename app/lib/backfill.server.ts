import type { Prisma } from "@prisma/client";
import type { SettingsDefaults, DateRange } from "./aiData";
import { fetchOrdersForRange } from "./shopifyOrders.server";
import { markActivity, updatePipelineStatuses } from "./settings.server";
import { persistOrders, removeDeletedOrders } from "./persistence.server";
import prisma from "../db.server";
import { withAdvisoryLock } from "./locks.server";
import { logger } from "./logger.server";
import { MAX_BACKFILL_DURATION_MS, MAX_BACKFILL_ORDERS, BACKFILL_TIMEOUT_MINUTES } from "./constants";

// 【修复】更新标题以反映实际的 60 天限制
const BACKFILL_STATUS_TITLE = "Hourly backfill (last 60 days)";

// 【修复】任务活动阈值（分钟）- 超过此时间的任务被认为已卡住，用户可以重新触发
// 这个值应该比 BACKFILL_TIMEOUT_MINUTES 小，让用户可以更快地重试
const BACKFILL_STALE_THRESHOLD_MINUTES = 2;

const setBackfillStatus = async (
  shopDomain: string,
  status: "healthy" | "warning" | "info",
  detail: string,
) => {
  if (!shopDomain) return;
  await updatePipelineStatuses(shopDomain, (statuses) => {
    const nextStatuses = [...statuses];
    const index = nextStatuses.findIndex((item) =>
      item.title.toLowerCase().includes("backfill"),
    );

    if (index >= 0) {
      nextStatuses[index] = { ...nextStatuses[index], status, detail };
      return nextStatuses;
    }

    return [...nextStatuses.slice(0, 1), { title: BACKFILL_STATUS_TITLE, status, detail }, ...nextStatuses.slice(1)];
  });
};

type BackfillDependencies = {
  settings: SettingsDefaults | null;
  admin:
    | { graphql: (query: string, options: { variables?: Record<string, unknown> }) => Promise<Response> }
    | null;
};

const dequeue = async (where: Prisma.BackfillJobWhereInput = {}) =>
  prisma.$transaction(async (tx) => {
    const pending = await tx.backfillJob.findFirst({
      where: { status: "queued", ...where },
      orderBy: { id: "asc" },
    });

    if (!pending) return null;

    const claimed = await tx.backfillJob.updateMany({
      where: { id: pending.id, status: "queued" },
      data: { status: "processing", startedAt: new Date() },
    });

    if (!claimed.count) {
      logger.warn("[backfill] attempted to claim missing job", { jobId: pending.id });
      return null;
    }

    return tx.backfillJob.findUnique({ where: { id: pending.id } });
  });

const updateJobStatus = async (
  id: number,
  status: "completed" | "failed",
  data: Partial<{ ordersFetched: number; error: string | null }> = {},
) => {
  const result = await prisma.backfillJob.updateMany({
    where: { id },
    data: { status, finishedAt: new Date(), ...data },
  });

  if (!result.count) {
    logger.warn("[backfill] attempted to update missing job", { jobId: id, status });
  }
};

const processQueue = async (
  resolveDependencies: (
    job: NonNullable<Awaited<ReturnType<typeof dequeue>>>,
  ) => Promise<BackfillDependencies>,
  where: Prisma.BackfillJobWhereInput = {},
) => {
  // 使用 advisory lock 确保跨实例的排他执行
  // withAdvisoryLock 是非阻塞的，如果锁被其他实例持有会立即返回
  const { lockInfo } = await withAdvisoryLock(1002, async () => {
    logger.info('[backfill] Acquired advisory lock, starting queue processing');
    for (;;) {
      const job = await dequeue(where);
      if (!job) break;

      const range: DateRange = {
        key: "custom",
        label: job.range,
        start: job.rangeStart,
        end: job.rangeEnd,
        days: Math.max(1, Math.round((job.rangeEnd.getTime() - job.rangeStart.getTime()) / 86_400_000)),
      };

      const { admin, settings } = await resolveDependencies(job);

      if (!admin || !settings) {
        logger.warn("[backfill] missing dependencies for queued job", {
          jobId: job.id,
          shopDomain: job.shopDomain,
          hasAdmin: Boolean(admin),
          hasSettings: Boolean(settings),
        });
        await updateJobStatus(job.id, "failed", { error: "missing dependencies" });
        continue;
      }

      try {
        const fetched = await fetchOrdersForRange(
          admin,
          range,
          settings,
          { shopDomain: job.shopDomain, intent: "queued-backfill", rangeLabel: range.label },
          {
            maxOrders: job.maxOrders ?? MAX_BACKFILL_ORDERS,
            maxDurationMs: job.maxDurationMs ?? MAX_BACKFILL_DURATION_MS,
          },
        );

        // 【修复】处理权限相关的错误，显示明确的提示
        if (fetched.error) {
          const errorDetail = fetched.error.suggestReauth 
            ? `${fetched.error.message} 建议商家重新授权。`
            : fetched.error.message;
          
          logger.warn("[backfill] job completed with access restriction", {
            jobType: "backfill",
            jobId: job.id,
            shopDomain: job.shopDomain,
            errorCode: fetched.error.code,
            suggestReauth: fetched.error.suggestReauth,
          });
          
          await updateJobStatus(job.id, "completed", { 
            ordersFetched: 0, 
            error: `[${fetched.error.code}] ${fetched.error.message}`,
          });
          await setBackfillStatus(
            job.shopDomain,
            "warning",
            errorDetail.slice(0, 100),
          );
          continue;
        }

        // 【优化 1】无论拉到多少单，都更新 lastBackfillAttemptAt 和 lastBackfillOrdersFetched
        const now = new Date();
        const activityUpdate: Parameters<typeof markActivity>[1] = {
          lastBackfillAttemptAt: now,
          lastBackfillOrdersFetched: fetched.orders.length,
        };
        
        // 只在有订单时更新 lastBackfillAt
        if (fetched.orders.length > 0) {
          await persistOrders(job.shopDomain, fetched.orders);
          activityUpdate.lastBackfillAt = now;
        }
        
        await markActivity(job.shopDomain, activityUpdate);

        // 【修复】删除数据库中存在但 Shopify 已删除的订单
        const shopifyOrderIds = new Set(fetched.orders.map(o => o.id));
        const deletedCount = await removeDeletedOrders(job.shopDomain, range, shopifyOrderIds);

        await updateJobStatus(job.id, "completed", { ordersFetched: fetched.orders.length });
        
        // 【优化 2】0 单时显示 info 而非 healthy，让用户明确知道"任务成功但无数据"
        const statusLevel = fetched.orders.length > 0 ? "healthy" : "info";
        const statusDetail = fetched.orders.length > 0
          ? `Last completed at ${now.toISOString()} · ${fetched.orders.length} orders`
          : `Completed at ${now.toISOString()} · 0 orders in last 60 days (Shopify default limit)`;
        
        await setBackfillStatus(job.shopDomain, statusLevel, statusDetail);
        logger.info("[backfill] job completed", {
          jobType: "backfill",
          jobId: job.id,
          shopDomain: job.shopDomain,
          ordersFetched: fetched.orders.length,
          deletedFromDb: deletedCount,
        });
      } catch (error) {
        const message = (error as Error).message;
        logger.error("[backfill] job failed", {
          jobType: "backfill",
          jobId: job.id,
          shopDomain: job.shopDomain,
          message,
        });
        await updateJobStatus(job.id, "failed", { error: message });
        await setBackfillStatus(
          job.shopDomain,
          "warning",
          `Failed at ${new Date().toISOString()}: ${message.slice(0, 50)}`,
        );
      }
    }
  }, { fallbackOnError: false });

  // 只有成功获取锁并完成处理后，才检查是否有新的待处理任务
  // 避免在未获取锁时无限递归调用
  if (lockInfo.acquired) {
    const pending = await prisma.backfillJob.count({ where: { status: "queued", ...where } });
    if (pending) {
      logger.debug('[backfill] Found pending jobs after processing, scheduling next run', { pending });
      // 【修复】使用 setImmediate 延迟执行，并添加错误处理
      // 避免使用 void 忽略 Promise，防止错误被静默丢弃
      setImmediate(() => {
        processQueue(resolveDependencies, where).catch((err) => {
          logger.error('[backfill] Recursive queue processing failed', {
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
          });
        });
      });
    }
  } else {
    logger.debug('[backfill] Skipped: lock held by another process', { reason: lockInfo.reason });
  }
};

/**
 * 清理特定店铺的卡住任务
 * 【修复】在检查/启动任务前调用，确保用户不会被卡住的任务阻塞
 */
const cleanupStaleJobsForShop = async (shopDomain: string): Promise<number> => {
  const staleThreshold = new Date(Date.now() - BACKFILL_STALE_THRESHOLD_MINUTES * 60 * 1000);
  const now = new Date();

  // 清理卡住的 queued 任务
  const queuedResult = await prisma.backfillJob.updateMany({
    where: {
      shopDomain,
      status: "queued",
      createdAt: { lt: staleThreshold },
    },
    data: {
      status: "failed",
      finishedAt: now,
      error: `Auto-cleaned: stuck in queue for more than ${BACKFILL_STALE_THRESHOLD_MINUTES} minutes`,
    },
  });

  // 清理卡住的 processing 任务
  const processingResult = await prisma.backfillJob.updateMany({
    where: {
      shopDomain,
      status: "processing",
      OR: [
        { startedAt: { lt: staleThreshold } },
        { startedAt: null, createdAt: { lt: staleThreshold } },
      ],
    },
    data: {
      status: "failed",
      finishedAt: now,
      error: `Auto-cleaned: processing stuck for more than ${BACKFILL_STALE_THRESHOLD_MINUTES} minutes`,
    },
  });

  const cleaned = queuedResult.count + processingResult.count;
  if (cleaned > 0) {
    logger.info("[backfill] Auto-cleaned stale jobs for shop", {
      shopDomain,
      queued: queuedResult.count,
      processing: processingResult.count,
      thresholdMinutes: BACKFILL_STALE_THRESHOLD_MINUTES,
    });
  }
  return cleaned;
};

/**
 * 检查是否有活动的补拉任务
 * 【修复】先清理卡住的任务，再检查是否有真正活动的任务
 */
export const isBackfillRunning = async (shopDomain: string): Promise<boolean> => {
  // 先清理卡住的任务，确保用户不会被阻塞
  await cleanupStaleJobsForShop(shopDomain);
  
  const count = await prisma.backfillJob.count({ 
    where: { shopDomain, status: { in: ["queued", "processing"] } } 
  });
  return count > 0;
};

export const describeBackfill = (shopDomain: string) =>
  prisma.backfillJob.findFirst({
    where: { shopDomain, status: { in: ["queued", "processing"] } },
    orderBy: { createdAt: "desc" },
  });

export const startBackfill = async (
  shopDomain: string,
  range: DateRange,
  options?: { maxOrders?: number; maxDurationMs?: number },
) => {
  if (!shopDomain) return { queued: false, reason: "missing shop domain" } as const;

  // 【修复】先清理卡住的任务，确保用户可以重新触发
  await cleanupStaleJobsForShop(shopDomain);

  const existing = await prisma.backfillJob.findFirst({
    where: { shopDomain, status: { in: ["queued", "processing"] } },
  });
  if (existing) {
    return { queued: false, reason: "in-flight" } as const;
  }

  await prisma.backfillJob.create({
    data: {
      shopDomain,
      range: range.label,
      rangeStart: range.start,
      rangeEnd: range.end,
      maxOrders: options?.maxOrders,
      maxDurationMs: options?.maxDurationMs,
    },
  });

  return { queued: true as const };
};

export const processBackfillQueue = async (
  resolveDependencies: (
    job: NonNullable<Awaited<ReturnType<typeof dequeue>>>,
  ) => Promise<BackfillDependencies>,
  where: Prisma.BackfillJobWhereInput = {},
) => processQueue(resolveDependencies, where);

/**
 * 清理超时的补拉任务
 * 将卡在 queued 或 processing 状态超过指定时间的任务标记为失败
 * 
 * 【修复】分别处理 queued 和 processing 状态：
 * - queued 状态：基于 createdAt 判断（排队超时）
 * - processing 状态：基于 startedAt 判断（处理超时）
 */
export const cleanupStaleBackfillJobs = async () => {
  const timeoutThreshold = new Date(Date.now() - BACKFILL_TIMEOUT_MINUTES * 60 * 1000);
  const now = new Date();
  
  // 1. 清理排队超时的任务（queued 状态，基于 createdAt）
  const queuedResult = await prisma.backfillJob.updateMany({
    where: {
      status: "queued",
      createdAt: { lt: timeoutThreshold },
    },
    data: {
      status: "failed",
      finishedAt: now,
      error: `Timed out: stuck in queue for more than ${BACKFILL_TIMEOUT_MINUTES} minutes`,
    },
  });

  // 2. 清理处理超时的任务（processing 状态，基于 startedAt）
  const processingResult = await prisma.backfillJob.updateMany({
    where: {
      status: "processing",
      startedAt: { lt: timeoutThreshold },
    },
    data: {
      status: "failed",
      finishedAt: now,
      error: `Timed out: processing for more than ${BACKFILL_TIMEOUT_MINUTES} minutes`,
    },
  });

  // 3. 清理 processing 状态但 startedAt 为空的异常任务（理论上不应该存在）
  const orphanResult = await prisma.backfillJob.updateMany({
    where: {
      status: "processing",
      startedAt: null,
      createdAt: { lt: timeoutThreshold },
    },
    data: {
      status: "failed",
      finishedAt: now,
      error: `Timed out: orphan processing job without startedAt`,
    },
  });

  const totalCleaned = queuedResult.count + processingResult.count + orphanResult.count;
  
  if (totalCleaned > 0) {
    logger.info("[backfill] Cleaned up stale jobs", { 
      queued: queuedResult.count, 
      processing: processingResult.count, 
      orphan: orphanResult.count,
      timeoutMinutes: BACKFILL_TIMEOUT_MINUTES,
    });
  }

  return totalCleaned;
};
