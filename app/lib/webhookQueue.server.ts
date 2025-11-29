type WebhookJob = {
  shopDomain: string;
  topic: string;
  intent: string;
  run: () => Promise<void>;
};

const queue: WebhookJob[] = [];
let processing = false;

const dequeue = () => queue.shift();

const processQueue = async () => {
  if (processing) return;
  processing = true;

  try {
    while (queue.length) {
      const job = dequeue();
      if (!job) break;

      const startedAt = Date.now();
      try {
        await job.run();
        console.info("[webhook] job completed", {
          shop: job.shopDomain,
          topic: job.topic,
          intent: job.intent,
          elapsedMs: Date.now() - startedAt,
        });
      } catch (error) {
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
    if (queue.length) {
      // Resume processing in case new jobs arrived while we were handling failures.
      void processQueue();
    }
  }
};

export const enqueueWebhookJob = (job: WebhookJob) => {
  queue.push(job);
  void processQueue();
};

export const getWebhookQueueSize = () => queue.length + (processing ? 1 : 0);
