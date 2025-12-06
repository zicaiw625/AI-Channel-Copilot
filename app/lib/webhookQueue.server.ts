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
const scheduledTimers = new Map<string, NodeJS.Timeout>(); // Track scheduled timers to prevent duplicates
const queue = getQueueConfig();
const MAX_RETRIES = queue.maxRetries;
const BASE_DELAY_MS = queue.baseDelayMs;
const MAX_DELAY_MS = queue.maxDelayMs;
const PENDING_COOLDOWN_MS = queue.pendingCooldownMs;
const MAX_BATCH = queue.maxBatch;
const PENDING_MAX_COOLDOWN_MS = queue.pendingMaxCooldownMs;
const STUCK_JOB_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const MAX_RECURSIVE_DEPTH = 100; // Maximum recursive scheduling depth per shop

const recoverStuckJobs = async (shopDomain: string) => {
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
    logger.error("[webhook] failed to recover stuck jobs", { shopDomain, error });
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

const updateJobStatus = async (
  id: number,
  status: "completed" | "failed",
  error?: string,
) => {
  const result = await prisma.webhookJob.updateMany({
    where: { id },
    data: { status, finishedAt: new Date(), ...(error ? { error } : {}) },
  });

  if (!result.count) {
    logger.warn("[webhook] soft warning: attempted to update missing job", {
      jobId: id,
      jobType: "webhook",
      intent: status,
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

export const enqueueWebhookJob = async (job: WebhookJob) => {
  if (!job || typeof job !== "object") return;
  const payloadIsObject = job.payload && typeof job.payload === "object";
  if (!payloadIsObject) {
    logger.warn("[webhook] payload rejected: must be object", { shopDomain: job.shopDomain, intent: job.intent });
    return;
  }
  if (!handlers.has(job.intent)) {
    handlers.set(job.intent, job.run);
  }

  if (job.externalId) {
    const exists = await prisma.webhookJob.findFirst({
      where: { shopDomain: job.shopDomain, topic: job.topic, externalId: job.externalId },
      select: { id: true },
    });
    if (exists) {
      logger.info("[webhook] duplicate ignored by externalId", { shopDomain: job.shopDomain, topic: job.topic });
      return;
    }
  }

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
      logger.info("[webhook] duplicate ignored by orderId", { shopDomain: job.shopDomain, topic: job.topic });
      return;
    }
  }

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

  void processWebhookQueueForShop(job.shopDomain, handlers);
};

export const getWebhookQueueSize = async () =>
  prisma.webhookJob.count({ where: { status: { in: ["queued", "processing"] } } });

export const getDeadLetterJobs = async (limit = 50) =>
  prisma.webhookJob.findMany({ where: { status: "failed" }, orderBy: { finishedAt: "desc" }, take: limit });
const hashKey = (value: string) => {
  let h = 0;
  for (let i = 0; i < value.length; i++) {
    h = (h * 31 + value.charCodeAt(i)) >>> 0;
  }
  return 1100 + (h % 1000000);
};

export const processWebhookQueueForShop = async (
  shopDomain: string,
  handlers: Map<string, WebhookJob["run"]>,
  recursiveDepth = 0,
) => {
  if (!shopDomain) return;
  const key = `shop:${shopDomain}`;
  if (processingKeys.has(key)) return;
  
  // Prevent infinite recursion
  if (recursiveDepth >= MAX_RECURSIVE_DEPTH) {
    logger.warn("[webhook] max recursive depth reached, stopping", { shopDomain, depth: recursiveDepth });
    return;
  }
  
  processingKeys.add(key);
  
  // Clear any existing scheduled timer for this shop
  const existingTimer = scheduledTimers.get(key);
  if (existingTimer) {
    clearTimeout(existingTimer);
    scheduledTimers.delete(key);
  }
  
  // Try to recover stuck jobs before processing
  await recoverStuckJobs(shopDomain);

  try {
    await withAdvisoryLock(hashKey(key), async () => {
      let processed = 0;
      for (;;) {
        if (processed >= Math.max(1, MAX_BATCH)) break;
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
          const message = (error as Error).message;
          logger.error("[webhook] job failed", context, {
            topic: job.topic,
            message,
          });

          const attempts = job.attempts || 0;
          if (attempts < MAX_RETRIES) {
            const jitter = Math.floor(Math.random() * BASE_DELAY_MS);
            const calc = BASE_DELAY_MS * 2 ** attempts + jitter;
            const nextDelay = Math.min(MAX_DELAY_MS, calc);
            const nextRun = new Date(Date.now() + nextDelay);
            await prisma.webhookJob.update({
              where: { id: job.id },
              data: {
                status: "queued",
                error: message,
                attempts: attempts + 1,
                nextRunAt: nextRun,
                finishedAt: null,
              },
            });
            logger.warn("[webhook] job scheduled for retry", context, { attempts: attempts + 1, nextDelay });
          } else {
            await updateJobStatus(job.id, "failed", message);
          }
        }
        processed++;
      }
    });
  } finally {
    processingKeys.delete(key);
    const pending = await prisma.webhookJob.count({ where: { status: "queued", shopDomain } });
    if (pending) {
      const dynamicDelay = Math.min(PENDING_COOLDOWN_MS + Math.floor(pending / Math.max(1, MAX_BATCH)) * 50, PENDING_MAX_COOLDOWN_MS);
      const timer = setTimeout(() => {
        scheduledTimers.delete(key);
        void processWebhookQueueForShop(shopDomain, handlers, recursiveDepth + 1);
      }, dynamicDelay);
      scheduledTimers.set(key, timer);
    }
  }
};
