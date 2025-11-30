import prisma from "../db.server";
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
const MAX_RETRIES = 2;

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
    while (true) {
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
        await updateJobStatus(job.id, "failed", (error as Error).message);
        logger.error("[webhook] job failed", context, {
          topic: job.topic,
          message: (error as Error).message,
        });

        if ((job.attempts || 0) < MAX_RETRIES) {
          const nextDelay = 200 * 2 ** (job.attempts || 0);
          const nextRun = new Date(Date.now() + nextDelay);
          await prisma.webhookJob.create({
            data: {
              shopDomain: job.shopDomain,
              topic: job.topic,
              intent: job.intent,
              payload: job.payload as Record<string, unknown>,
              externalId: job.externalId || null,
              orderId: job.orderId || null,
              eventTime: job.eventTime || null,
              attempts: (job.attempts || 0) + 1,
              nextRunAt: nextRun,
              status: "queued",
            },
          });
          logger.warn("[webhook] job scheduled for retry", context, { attempts: (job.attempts || 0) + 1, nextDelay });
        }
      }
    }
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

  await prisma.webhookJob.create({
    data: {
      shopDomain: job.shopDomain,
      topic: job.topic,
      intent: job.intent,
      payload: job.payload,
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
