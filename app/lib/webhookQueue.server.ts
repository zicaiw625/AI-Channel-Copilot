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

/**
 * LRU Handler Cache
 * 使用时间戳追踪最后使用时间，实现真正的 LRU 淘汰策略
 */
type HandlerEntry = {
  handler: WebhookJob["run"];
  lastUsedAt: number;
};

const handlers = new Map<string, HandlerEntry>();

/**
 * 注册 webhook handler（带 LRU 追踪）
 */
export const registerWebhookHandler = (
  intent: string,
  handler: WebhookJob["run"],
) => {
  handlers.set(intent, {
    handler,
    lastUsedAt: Date.now(),
  });
};

/**
 * 获取 handler 并更新 LRU 时间戳
 */
const getHandler = (intent: string): WebhookJob["run"] | undefined => {
  const entry = handlers.get(intent);
  if (entry) {
    // 更新最后使用时间
    entry.lastUsedAt = Date.now();
    return entry.handler;
  }
  return undefined;
};

/**
 * 真正的 LRU 淘汰：删除最不常用的 handler
 * 保留最近使用的 handler，删除最久未使用的
 */
const evictLRUHandlers = (targetSize: number) => {
  if (handlers.size <= targetSize) return;
  
  // 按最后使用时间排序
  const entries = Array.from(handlers.entries())
    .sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);
  
  // 删除最久未使用的，直到达到目标大小
  const toDelete = handlers.size - targetSize;
  for (let i = 0; i < toDelete && i < entries.length; i++) {
    handlers.delete(entries[i][0]);
  }
  
  logger.debug("[webhook] LRU eviction completed", {
    deleted: toDelete,
    remaining: handlers.size,
  });
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

  // 注册 handler（带 LRU 淘汰策略）
  if (!handlers.has(job.intent)) {
    // 如果达到容量限制，使用 LRU 策略淘汰旧 handler
    if (handlers.size >= MAX_HANDLERS) {
      logger.warn("[webhook] handlers map at capacity, evicting LRU entries", { 
        size: handlers.size,
        maxHandlers: MAX_HANDLERS,
      });
      // 保留 70% 的 handler（删除最久未使用的 30%）
      evictLRUHandlers(Math.floor(MAX_HANDLERS * 0.7));
    }
    handlers.set(job.intent, {
      handler: job.run,
      lastUsedAt: Date.now(),
    });
  } else {
    // 更新已存在 handler 的最后使用时间
    const entry = handlers.get(job.intent);
    if (entry) {
      entry.lastUsedAt = Date.now();
    }
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

  void processWebhookQueueForShop(job.shopDomain);
};

export const getWebhookQueueSize = async () =>
  prisma.webhookJob.count({ where: { status: { in: ["queued", "processing"] } } });

export const getDeadLetterJobs = async (limit = 50) =>
  prisma.webhookJob.findMany({ where: { status: "failed" }, orderBy: { finishedAt: "desc" }, take: limit });

/**
 * 🆕 队列唤醒扫描器
 * 扫描 DB 中所有 due 的任务，触发各店铺的队列处理
 * 用于解决进程重启后 setTimeout 丢失导致的任务卡死问题
 * 
 * 多实例部署时，依赖现有的 advisory lock 机制避免重复消费
 */
export const wakeupDueWebhookJobs = async (): Promise<{ shopsWoken: number }> => {
  if (isShuttingDown) {
    return { shopsWoken: 0 };
  }

  try {
    const now = new Date();
    
    // 查找所有有 due 任务的店铺（distinct shopDomain）
    const shopsWithDueJobs = await prisma.webhookJob.groupBy({
      by: ["shopDomain"],
      where: {
        status: "queued",
        OR: [
          { nextRunAt: null },
          { nextRunAt: { lte: now } },
        ],
      },
      _count: { _all: true },
    });

    if (shopsWithDueJobs.length === 0) {
      return { shopsWoken: 0 };
    }

    logger.info("[webhook] Wakeup scanner found due jobs", {
      shopsCount: shopsWithDueJobs.length,
      totalJobs: shopsWithDueJobs.reduce((sum, s) => sum + s._count._all, 0),
    });

    // 触发各店铺的队列处理（不等待完成）
    for (const shop of shopsWithDueJobs) {
      void processWebhookQueueForShop(shop.shopDomain);
    }

    return { shopsWoken: shopsWithDueJobs.length };
  } catch (error) {
    logger.error("[webhook] Wakeup scanner failed", {
      error: sanitizeErrorMessage(error),
    });
    return { shopsWoken: 0 };
  }
};

/**
 * 🆕 早期去重检查（Shopify 最佳实践）
 * 在入队前检查 X-Shopify-Webhook-Id 是否已处理
 * 这比依赖数据库唯一约束更高效，避免不必要的入队和处理
 * 
 * @param shopDomain - 店铺域名
 * @param topic - Webhook 主题
 * @param externalId - X-Shopify-Webhook-Id
 * @returns 是否为重复的 webhook
 */
export const checkWebhookDuplicate = async (
  shopDomain: string,
  topic: string,
  externalId: string,
): Promise<boolean> => {
  if (!externalId) return false;
  
  try {
    // 检查是否已存在相同的 webhook（任何状态）
    const existing = await prisma.webhookJob.findFirst({
      where: {
        shopDomain,
        topic,
        externalId,
      },
      select: { id: true, status: true },
    });
    
    if (existing) {
      // 记录重复 webhook 的监控指标
      logger.debug("[webhook] Duplicate detected by externalId", {
        shopDomain,
        topic,
        externalId,
        existingStatus: existing.status,
      });
      return true;
    }
    
    return false;
  } catch (error) {
    // 查询失败时不阻止正常处理，记录警告后继续
    logger.warn("[webhook] Duplicate check failed, proceeding", {
      shopDomain,
      topic,
      error: sanitizeErrorMessage(error),
    });
    return false;
  }
};

/**
 * 处理指定店铺的 Webhook 队列
 * 使用模块级 handlers Map，无需外部传入
 */
export const processWebhookQueueForShop = async (
  shopDomain: string,
  _handlers?: Map<string, WebhookJob["run"]>, // 保留参数签名兼容性，但不再使用
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
        // 使用 getHandler 获取 handler 并更新 LRU 时间戳
        const handler = getHandler(job.intent);
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
        void processWebhookQueueForShop(shopDomain, undefined, recursiveDepth + 1);
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
