import prisma from "../db.server";
import { withAdvisoryLock } from "./locks.server";
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

let processing = false;
const MAX_RETRIES = Number(process.env.WEBHOOK_MAX_RETRIES || 5);
const BASE_DELAY_MS = Number(process.env.WEBHOOK_BASE_DELAY_MS || 500);
const MAX_DELAY_MS = Number(process.env.WEBHOOK_MAX_DELAY_MS || 30000);

const dequeue = async () => {
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const pending = await tx.webhookJob.findFirst({
      where: { status: "queued", OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }] },
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

const processQueue = async (handlers: Map<string, WebhookJob["run"]>) => {
  if (processing) return;
  processing = true;

  try {
    await withAdvisoryLock(1001, async () => {
      for (;;) {
        const job = await dequeue();
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
      }
    });
  } finally {
    processing = false;
    const pending = await prisma.webhookJob.count({ where: { status: "queued" } });
    if (pending) {
      // Resume processing in case new jobs arrived while we were handling failures.
      void processQueue(handlers);
    }
  }
};

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

  void processQueue(handlers);
};

export const getWebhookQueueSize = async () =>
  prisma.webhookJob.count({ where: { status: { in: ["queued", "processing"] } } });

export const getDeadLetterJobs = async (limit = 50) =>
  prisma.webhookJob.findMany({ where: { status: "failed" }, orderBy: { finishedAt: "desc" }, take: limit });
