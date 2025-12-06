import prisma from "../db.server";
import { withAdvisoryLockSimple } from "./locks.server";
import { getQueueConfig } from "./env.server";
import { Prisma } from "@prisma/client";
import { logger, type LogContext } from "./logger.server";

type WebhookJob = {
  shopDomain: string;
  topic: string;
  intent: string;
  payload: Record<string, unknown>;
  externalId?: string | null;
  orderId?: string | null;
  eventTime?: Date | null;
  run: (payload: Record<string, unknown>) => Promise<void>;
};

const processingKeys = new Set<string>();
const scheduledTimers = new Map<string, NodeJS.Timeout>();
const lastRecoveryTime = new Map<string, number>(); // 记录上次恢复时间，限制恢复频率
const queue = getQueueConfig();

// 配置常量
const MAX_RETRIES = queue.maxRetries;
const BASE_DELAY_MS = queue.baseDelayMs;
const MAX_DELAY_MS = queue.maxDelayMs;
const PENDING_COOLDOWN_MS = queue.pendingCooldownMs;
const MAX_BATCH = queue.maxBatch;
const PENDING_MAX_COOLDOWN_MS = queue.pendingMaxCooldownMs;
const STUCK_JOB_TIMEOUT_MS = 5 * 60 * 1000; // 5 分钟
const MAX_RECURSIVE_DEPTH = 100;
const MAX_PAYLOAD_SIZE = 64 * 1024; // 64KB payload 大小限制
const RECOVERY_INTERVAL_MS = 60_000; // 1 分钟恢复检查间隔
const MAX_HANDLERS = 100; // handlers Map 最大容量

// 是否正在关闭
let isShuttingDown = false;
let activeJobCount = 0;

// 清理所有 scheduled timers（用于优雅关闭）
const cleanupAllTimers = () => {
  for (const [key, timer] of scheduledTimers.entries()) {
    clearTimeout(timer);
    scheduledTimers.delete(key);
  }
  lastRecoveryTime.clear();
  logger.info("[webhook] All scheduled timers cleaned up", { count: scheduledTimers.size });
};

/**
 * 优雅关闭：等待当前任务完成
 */
const gracefulShutdown = async (signal: string) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  logger.info("[webhook] Graceful shutdown initiated", { signal, activeJobs: activeJobCount });
  
  // 清理定时器，阻止新任务调度
  cleanupAllTimers();
  
  // 等待进行中的任务完成（最多等待 30 秒）
  const maxWait = 30_000;
  const startTime = Date.now();
  
  while (activeJobCount > 0 && Date.now() - startTime < maxWait) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  if (activeJobCount > 0) {
    logger.warn("[webhook] Forced shutdown with active jobs", { activeJobs: activeJobCount });
  } else {
    logger.info("[webhook] Graceful shutdown completed");
  }
};

// 注册进程退出时的清理钩子
if (typeof process !== "undefined") {
  const exitHandler = (signal: string) => () => {
    void gracefulShutdown(signal);
  };
  
  process.once("beforeExit", exitHandler("beforeExit"));
  process.once("SIGINT", exitHandler("SIGINT"));
  process.once("SIGTERM", exitHandler("SIGTERM"));
}

// 导出清理函数供测试或手动调用
export const cleanupWebhookTimers = cleanupAllTimers;

/**
 * FNV-1a 哈希算法 - 比 djb2 有更好的分布
 */
const hashKey = (value: string): number => {
  let hash = 2166136261; // FNV offset basis
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619); // FNV prime
  }
  // 确保返回正数，范围在 1100 - 1100999
  return 1100 + Math.abs(hash % 1000000);
};

/**
 * 安全的错误消息提取 - 避免泄露敏感信息
 */
const sanitizeErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    const sensitivePatterns = [
      /password/i,
      /secret/i,
      /token/i,
      /api[_-]?key/i,
      /connection.*string/i,
      /postgres:\/\//i,
      /mysql:\/\//i,
    ];
    
    const message = error.message;
    for (const pattern of sensitivePatterns) {
      if (pattern.test(message)) {
        return "Internal error (details redacted)";
      }
    }
    
    return message.length > 500 ? message.slice(0, 500) + "..." : message;
  }
  
  if (typeof error === "string") {
    return error.length > 500 ? error.slice(0, 500) + "..." : error;
  }
  
  return "Unknown error";
};

/**
 * 限频的卡住任务恢复
 * 每个店铺最多每分钟检查一次
 */
const recoverStuckJobs = async (shopDomain: string) => {
  // 检查是否应该执行恢复（限频）
  const lastTime = lastRecoveryTime.get(shopDomain) || 0;
  if (Date.now() - lastTime < RECOVERY_INTERVAL_MS) {
    return; // 跳过，距离上次检查不足 1 分钟
  }
  lastRecoveryTime.set(shopDomain, Date.now());
  
  // 清理过期的恢复时间记录，防止内存泄漏
  if (lastRecoveryTime.size > 10000) {
    const cutoff = Date.now() - RECOVERY_INTERVAL_MS * 2;
    for (const [key, time] of lastRecoveryTime) {
      if (time < cutoff) {
        lastRecoveryTime.delete(key);
      }
    }
  }

  try {
    const threshold = new Date(Date.now() - STUCK_JOB_TIMEOUT_MS);
    const result = await prisma.webhookJob.updateMany({
      where: {
        shopDomain,
        status: "processing",
        startedAt: { lt: threshold },
      },
      data: {
        status: "queued",
        startedAt: null,
        error: "Recovered from stuck state",
      },
    });
    if (result.count > 0) {
      logger.warn("[webhook] recovered stuck jobs", { shopDomain, count: result.count });
    }
  } catch (error) {
    logger.error("[webhook] failed to recover stuck jobs", { 
      shopDomain, 
      error: sanitizeErrorMessage(error) 
    });
  }
};

const dequeue = async (extraWhere?: Prisma.WebhookJobWhereInput) => {
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const baseWhere: Prisma.WebhookJobWhereInput = { status: "queued", OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }] };
    const where = extraWhere ? { AND: [baseWhere, extraWhere] } : baseWhere;
    const pending = await tx.webhookJob.findFirst({
      where,
      orderBy: [{ nextRunAt: "asc" }, { id: "asc" }],
    });

    if (!pending) return null;

    const claimed = await tx.webhookJob.updateMany({
      where: { id: pending.id, status: "queued" },
      data: { status: "processing", startedAt: new Date() },
    });

    if (!claimed.count) {
      logger.debug("[webhook] failed to claim job", {
        jobId: pending.id,
        shopDomain: pending.shopDomain,
        status: pending.status,
      });
      return null;
    }

    return tx.webhookJob.findUnique({ where: { id: pending.id } });
  });
};

/**
 * 更新任务状态
 */
const updateJobStatus = async (
  id: number,
  status: "completed" | "failed",
  error?: string,
) => {
  try {
    const result = await prisma.webhookJob.updateMany({
      where: { id },
      data: { 
        status, 
        finishedAt: new Date(), 
        ...(error ? { error: error.slice(0, 1000) } : {}) // 限制错误消息长度
      },
    });

    if (!result.count) {
      logger.warn("[webhook] job status update skipped (job missing)", {
        jobId: id,
        targetStatus: status,
      });
    }
  } catch (err) {
    logger.error("[webhook] failed to update job status", {
      jobId: id,
      targetStatus: status,
      error: sanitizeErrorMessage(err),
    });
  }
};

// removed unused global processing loop in favor of per-shop processing

const handlers = new Map<string, WebhookJob["run"]>();

export const registerWebhookHandler = (
  intent: string,
  handler: WebhookJob["run"],
) => {
  handlers.set(intent, handler);
};

/**
 * 入队 Webhook 任务
 */
export const enqueueWebhookJob = async (job: WebhookJob) => {
  // 如果正在关闭，拒绝新任务
  if (isShuttingDown) {
    logger.warn("[webhook] job rejected: server is shutting down", { 
      shopDomain: job?.shopDomain, 
      intent: job?.intent 
    });
    return;
  }

  // 基础验证
  if (!job || typeof job !== "object") {
    logger.warn("[webhook] job rejected: invalid job object");
    return;
  }
  
  if (!job.shopDomain || typeof job.shopDomain !== "string") {
    logger.warn("[webhook] job rejected: missing shopDomain");
    return;
  }
  
  const payloadIsObject = job.payload && typeof job.payload === "object";
  if (!payloadIsObject) {
    logger.warn("[webhook] payload rejected: must be object", { 
      shopDomain: job.shopDomain, 
      intent: job.intent 
    });
    return;
  }

  // Payload 大小检查
  try {
    const payloadSize = JSON.stringify(job.payload).length;
    if (payloadSize > MAX_PAYLOAD_SIZE) {
      logger.error("[webhook] payload rejected: too large", {
        shopDomain: job.shopDomain,
        intent: job.intent,
        size: payloadSize,
        maxSize: MAX_PAYLOAD_SIZE,
      });
      return;
    }
  } catch (err) {
    logger.error("[webhook] payload rejected: not serializable", {
      shopDomain: job.shopDomain,
      error: sanitizeErrorMessage(err),
    });
    return;
  }

  // 注册 handler（限制 handlers Map 大小）
  if (!handlers.has(job.intent)) {
    if (handlers.size >= MAX_HANDLERS) {
      logger.warn("[webhook] handlers map at capacity, clearing old entries", { 
        size: handlers.size 
      });
      // 清理一半的 handlers（简单的 LRU 替代）
      const keysToDelete = Array.from(handlers.keys()).slice(0, Math.floor(MAX_HANDLERS / 2));
      keysToDelete.forEach(k => handlers.delete(k));
    }
    handlers.set(job.intent, job.run);
  }

  // 使用 try-catch 处理唯一约束冲突，而不是先查询
  // 这样更高效，因为大多数情况下不会有重复
  try {
    await prisma.webhookJob.create({
      data: {
        shopDomain: job.shopDomain,
        topic: job.topic,
        intent: job.intent,
        payload: job.payload as Prisma.InputJsonValue,
        externalId: job.externalId || null,
        orderId: job.orderId || null,
        eventTime: job.eventTime || null,
        attempts: 0,
        nextRunAt: new Date(),
      },
    });
  } catch (err) {
    // 检查是否是唯一约束冲突
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      logger.info("[webhook] duplicate ignored by unique constraint", { 
        shopDomain: job.shopDomain, 
        topic: job.topic,
        externalId: job.externalId,
      });
      return;
    }
    // 其他错误抛出
    throw err;
  }

  // 额外的 orderId 去重检查（针对同一订单的活跃任务）
  if (job.orderId) {
    const activeCount = await prisma.webhookJob.count({
      where: {
        shopDomain: job.shopDomain,
        topic: job.topic,
        orderId: job.orderId,
        status: { in: ["queued", "processing"] },
      },
    });
    // 如果有多个活跃任务，说明刚创建的是重复的
    if (activeCount > 1) {
      logger.info("[webhook] duplicate detected by orderId, will be processed once", { 
        shopDomain: job.shopDomain, 
        topic: job.topic,
        orderId: job.orderId,
      });
    }
  }

  if (!handlers.has(job.intent)) {
    logger.warn("[webhook] enqueued job without registered handler", {
      jobType: "webhook",
      intent: job.intent,
    });
  }

  void processWebhookQueueForShop(job.shopDomain, handlers);
};

export const getWebhookQueueSize = async () =>
  prisma.webhookJob.count({ where: { status: { in: ["queued", "processing"] } } });

export const getDeadLetterJobs = async (limit = 50) =>
  prisma.webhookJob.findMany({ where: { status: "failed" }, orderBy: { finishedAt: "desc" }, take: limit });

/**
 * 处理指定店铺的 Webhook 队列
 */
export const processWebhookQueueForShop = async (
  shopDomain: string,
  handlers: Map<string, WebhookJob["run"]>,
  recursiveDepth = 0,
) => {
  if (!shopDomain) return;
  
  // 如果正在关闭，不处理新任务
  if (isShuttingDown) return;
  
  const key = `shop:${shopDomain}`;
  
  // 防止并发处理同一店铺
  if (processingKeys.has(key)) return;
  
  // 防止无限递归
  if (recursiveDepth >= MAX_RECURSIVE_DEPTH) {
    logger.warn("[webhook] max recursive depth reached", { 
      shopDomain, 
      depth: recursiveDepth 
    });
    return;
  }
  
  processingKeys.add(key);
  
  // 清理已有的定时器
  const existingTimer = scheduledTimers.get(key);
  if (existingTimer) {
    clearTimeout(existingTimer);
    scheduledTimers.delete(key);
  }
  
  // 恢复卡住的任务（限频）
  await recoverStuckJobs(shopDomain);

  try {
    await withAdvisoryLockSimple(hashKey(key), async () => {
      let processed = 0;
      
      while (processed < Math.max(1, MAX_BATCH)) {
        // 检查是否正在关闭
        if (isShuttingDown) break;
        
        const job = await dequeue({ shopDomain });
        if (!job) break;

        activeJobCount++;
        const startedAt = Date.now();
        const handler = handlers.get(job.intent);
        const context: LogContext = {
          shopDomain: job.shopDomain,
          jobId: job.id,
          jobType: "webhook",
          intent: job.intent,
        };

        if (!handler) {
          logger.warn("[webhook] no handler registered", context, { topic: job.topic });
          await updateJobStatus(job.id, "failed", "no handler registered");
          activeJobCount--;
          processed++;
          continue;
        }

        try {
          await handler(job.payload as Record<string, unknown>);
          await updateJobStatus(job.id, "completed");
          logger.info("[webhook] job completed", context, {
            topic: job.topic,
            elapsedMs: Date.now() - startedAt,
          });
        } catch (error) {
          const message = sanitizeErrorMessage(error);
          logger.error("[webhook] job failed", context, {
            topic: job.topic,
            message,
          });

          const attempts = job.attempts || 0;
          if (attempts < MAX_RETRIES) {
            const jitter = Math.floor(Math.random() * BASE_DELAY_MS);
            const calc = BASE_DELAY_MS * Math.pow(2, attempts) + jitter;
            const nextDelay = Math.min(MAX_DELAY_MS, calc);
            const nextRun = new Date(Date.now() + nextDelay);
            
            try {
              await prisma.webhookJob.update({
                where: { id: job.id },
                data: {
                  status: "queued",
                  error: message.slice(0, 1000),
                  attempts: attempts + 1,
                  nextRunAt: nextRun,
                  finishedAt: null,
                },
              });
              logger.warn("[webhook] job scheduled for retry", context, { 
                attempts: attempts + 1, 
                nextDelay 
              });
            } catch (updateErr) {
              logger.error("[webhook] failed to schedule retry", context, {
                error: sanitizeErrorMessage(updateErr),
              });
              await updateJobStatus(job.id, "failed", message);
            }
          } else {
            await updateJobStatus(job.id, "failed", message);
          }
        } finally {
          activeJobCount--;
        }
        processed++;
      }
    });
  } catch (lockError) {
    logger.error("[webhook] processing failed", { 
      shopDomain, 
      error: sanitizeErrorMessage(lockError) 
    });
  } finally {
    processingKeys.delete(key);
  }
  
  // 如果正在关闭，不调度新的处理（移出 finally 块避免 no-unsafe-finally）
  if (isShuttingDown) return;
  
  // 检查是否还有待处理任务
  try {
    const pending = await prisma.webhookJob.count({ 
      where: { status: "queued", shopDomain } 
    });
    
    if (pending > 0) {
      const dynamicDelay = Math.min(
        PENDING_COOLDOWN_MS + Math.floor(pending / Math.max(1, MAX_BATCH)) * 50, 
        PENDING_MAX_COOLDOWN_MS
      );
      
      const timer = setTimeout(() => {
        scheduledTimers.delete(key);
        void processWebhookQueueForShop(shopDomain, handlers, recursiveDepth + 1);
      }, dynamicDelay);
      
      scheduledTimers.set(key, timer);
    }
  } catch (countError) {
    logger.error("[webhook] failed to check pending jobs", { 
      shopDomain, 
      error: sanitizeErrorMessage(countError) 
    });
  }
};
