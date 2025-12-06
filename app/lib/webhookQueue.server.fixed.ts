/**
 * Webhook Queue Server - 修复版本
 * 
 * 修复内容：
 * 1. 改进哈希函数避免锁冲突
 * 2. 添加 payload 大小限制
 * 3. 优化错误处理
 * 4. 添加批量出队支持
 * 5. 限制 recoverStuckJobs 调用频率
 */

import prisma from "../db.server";
import { withAdvisoryLock } from "./locks.server";
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
const lastRecoveryTime = new Map<string, number>(); // 新增：记录上次恢复时间
const queue = getQueueConfig();

// 配置常量
const MAX_RETRIES = queue.maxRetries;
const BASE_DELAY_MS = queue.baseDelayMs;
const MAX_DELAY_MS = queue.maxDelayMs;
const PENDING_COOLDOWN_MS = queue.pendingCooldownMs;
const MAX_BATCH = queue.maxBatch;
const PENDING_MAX_COOLDOWN_MS = queue.pendingMaxCooldownMs;
const STUCK_JOB_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_RECURSIVE_DEPTH = 100;
const MAX_PAYLOAD_SIZE = 64 * 1024; // 64KB payload 大小限制
const RECOVERY_INTERVAL_MS = 60_000; // 1 分钟恢复检查间隔

// 清理函数
const cleanupAllTimers = () => {
  for (const [key, timer] of scheduledTimers.entries()) {
    clearTimeout(timer);
    scheduledTimers.delete(key);
  }
};

if (typeof process !== "undefined") {
  const exitHandler = () => cleanupAllTimers();
  process.once("beforeExit", exitHandler);
  process.once("SIGINT", exitHandler);
  process.once("SIGTERM", exitHandler);
}

export const cleanupWebhookTimers = cleanupAllTimers;

/**
 * 改进的哈希函数 - 使用 FNV-1a 算法
 * 提供更好的分布，减少锁冲突
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
 * 安全的错误消息提取
 * 避免泄露敏感信息
 */
const sanitizeErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    // 过滤可能包含敏感信息的关键词
    const sensitivePatterns = [
      /password/i,
      /secret/i,
      /token/i,
      /api[_-]?key/i,
      /connection.*string/i,
      /postgres:\/\//i,
      /mysql:\/\//i,
    ];
    
    let message = error.message;
    for (const pattern of sensitivePatterns) {
      if (pattern.test(message)) {
        return "Internal error (details redacted)";
      }
    }
    
    // 截断过长的消息
    return message.length > 500 ? message.slice(0, 500) + "..." : message;
  }
  
  if (typeof error === "string") {
    return error.length > 500 ? error.slice(0, 500) + "..." : error;
  }
  
  return "Unknown error";
};

/**
 * 限频的卡住任务恢复
 */
const recoverStuckJobs = async (shopDomain: string) => {
  // 检查是否应该执行恢复
  const lastTime = lastRecoveryTime.get(shopDomain) || 0;
  if (Date.now() - lastTime < RECOVERY_INTERVAL_MS) {
    return; // 跳过，距离上次检查不足 1 分钟
  }
  lastRecoveryTime.set(shopDomain, Date.now());

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

/**
 * 出队单个任务
 */
const dequeue = async (extraWhere?: Prisma.WebhookJobWhereInput) => {
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const baseWhere: Prisma.WebhookJobWhereInput = { 
      status: "queued", 
      OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }] 
    };
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
      logger.debug("[webhook] failed to claim job (race condition)", {
        jobId: pending.id,
        shopDomain: pending.shopDomain,
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

  // 新增：Payload 大小检查
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

  // 注册 handler
  if (!handlers.has(job.intent)) {
    handlers.set(job.intent, job.run);
  }

  // 去重检查：externalId
  if (job.externalId) {
    const exists = await prisma.webhookJob.findFirst({
      where: { shopDomain: job.shopDomain, topic: job.topic, externalId: job.externalId },
      select: { id: true },
    });
    if (exists) {
      logger.info("[webhook] duplicate ignored by externalId", { 
        shopDomain: job.shopDomain, 
        topic: job.topic,
        externalId: job.externalId,
      });
      return;
    }
  }

  // 去重检查：orderId（仅检查活跃任务）
  if (job.orderId) {
    const existsByOrder = await prisma.webhookJob.findFirst({
      where: {
        shopDomain: job.shopDomain,
        topic: job.topic,
        orderId: job.orderId,
        status: { in: ["queued", "processing"] },
      },
      select: { id: true },
    });
    if (existsByOrder) {
      logger.info("[webhook] duplicate ignored by orderId", { 
        shopDomain: job.shopDomain, 
        topic: job.topic,
        orderId: job.orderId,
      });
      return;
    }
  }

  // 创建任务
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

  if (!handlers.has(job.intent)) {
    logger.warn("[webhook] enqueued job without registered handler", {
      jobType: "webhook",
      intent: job.intent,
    });
  }

  // 异步触发处理
  void processWebhookQueueForShop(job.shopDomain, handlers);
};

export const getWebhookQueueSize = async () =>
  prisma.webhookJob.count({ where: { status: { in: ["queued", "processing"] } } });

export const getDeadLetterJobs = async (limit = 50) =>
  prisma.webhookJob.findMany({ 
    where: { status: "failed" }, 
    orderBy: { finishedAt: "desc" }, 
    take: limit 
  });

/**
 * 处理指定店铺的 Webhook 队列
 */
export const processWebhookQueueForShop = async (
  shopDomain: string,
  handlers: Map<string, WebhookJob["run"]>,
  recursiveDepth = 0,
) => {
  if (!shopDomain) return;
  
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
    await withAdvisoryLock(hashKey(key), async () => {
      let processed = 0;
      
      while (processed < Math.max(1, MAX_BATCH)) {
        const job = await dequeue({ shopDomain });
        if (!job) break;

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
  }
};
