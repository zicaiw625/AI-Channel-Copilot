import prisma from "../db.server";

type WebhookJob = {
  shopDomain: string;
  topic: string;
  intent: string;
  payload: Record<string, unknown>;
  run: (payload: Record<string, unknown>) => Promise<void>;
};

let processing = false;

const dequeue = async () => {
  return prisma.$transaction(async (tx) => {
    const pending = await tx.webhookJob.findFirst({
      where: { status: "queued" },
      orderBy: { id: "asc" },
    });

    if (!pending) return null;

    const claimed = await tx.webhookJob.updateMany({
      where: { id: pending.id, status: "queued" },
      data: { status: "processing", startedAt: new Date() },
    });

    if (!claimed.count) return null;

    return tx.webhookJob.findUnique({ where: { id: pending.id } });
  });
};

const updateJobStatus = async (
  id: number,
  status: "completed" | "failed",
  error?: string,
) => {
  await prisma.webhookJob.update({
    where: { id },
    data: { status, finishedAt: new Date(), ...(error ? { error } : {}) },
  });
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

      if (!handler) {
        console.warn("[webhook] no handler registered", {
          shop: job.shopDomain,
          topic: job.topic,
          intent: job.intent,
        });
        await updateJobStatus(job.id, "failed", "no handler registered");
        continue;
      }

      try {
        await handler(job.payload as Record<string, unknown>);
        await updateJobStatus(job.id, "completed");
        console.info("[webhook] job completed", {
          shop: job.shopDomain,
          topic: job.topic,
          intent: job.intent,
          elapsedMs: Date.now() - startedAt,
        });
      } catch (error) {
        await updateJobStatus(job.id, "failed", (error as Error).message);
        console.error("[webhook] job failed", {
          shop: job.shopDomain,
          topic: job.topic,
          intent: job.intent,
          message: (error as Error).message,
        });
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

  await prisma.webhookJob.create({
    data: {
      shopDomain: job.shopDomain,
      topic: job.topic,
      intent: job.intent,
      payload: job.payload,
    },
  });

  if (!handlers.has(job.intent)) {
    console.warn("[webhook] enqueued job without registered handler", { intent: job.intent });
  }

  void processQueue(handlers);
};

export const getWebhookQueueSize = async () =>
  prisma.webhookJob.count({ where: { status: { in: ["queued", "processing"] } } });
