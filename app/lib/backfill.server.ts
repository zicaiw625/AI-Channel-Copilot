import type { SettingsDefaults } from "./aiData";
import { fetchOrdersForRange } from "./shopifyOrders.server";
import type { DateRange } from "./aiData";
import { markActivity } from "./settings.server";
import { persistOrders } from "./persistence.server";
import prisma from "../db.server";
import { logger } from "./logger.server";
import { MAX_BACKFILL_DURATION_MS, MAX_BACKFILL_ORDERS } from "./constants";

type BackfillPayload = {
  range: DateRange;
  settings: SettingsDefaults;
  options?: { maxOrders?: number; maxDurationMs?: number };
  admin: { graphql: (query: string, options: { variables?: Record<string, unknown> }) => Promise<Response> };
};

const payloads = new Map<number, BackfillPayload>();
let processing = false;

const dequeue = async () =>
  prisma.$transaction(async (tx) => {
    const pending = await tx.backfillJob.findFirst({
      where: { status: "queued" },
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

const processQueue = async () => {
  if (processing) return;
  processing = true;

  try {
    while (true) {
      const job = await dequeue();
      if (!job) break;

      const payload = payloads.get(job.id);

      if (!payload) {
        logger.warn("[backfill] missing payload for queued job", { jobId: job.id });
        await updateJobStatus(job.id, "failed", { error: "missing payload" });
        continue;
      }

      try {
        const fetched = await fetchOrdersForRange(
          payload.admin,
          payload.range,
          payload.settings,
          { shopDomain: job.shopDomain, intent: "queued-backfill", rangeLabel: payload.range.label },
          {
            maxOrders: payload.options?.maxOrders ?? MAX_BACKFILL_ORDERS,
            maxDurationMs: payload.options?.maxDurationMs ?? MAX_BACKFILL_DURATION_MS,
          },
        );

        if (fetched.orders.length > 0) {
          await persistOrders(job.shopDomain, fetched.orders);
          await markActivity(job.shopDomain, { lastBackfillAt: new Date() });
        }

        await updateJobStatus(job.id, "completed", { ordersFetched: fetched.orders.length });
        logger.info("[backfill] job completed", {
          jobType: "backfill",
          jobId: job.id,
          shopDomain: job.shopDomain,
          ordersFetched: fetched.orders.length,
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
      } finally {
        payloads.delete(job.id);
      }
    }
  } finally {
    processing = false;
    const pending = await prisma.backfillJob.count({ where: { status: "queued" } });
    if (pending) void processQueue();
  }
};

export const isBackfillRunning = (shopDomain: string) =>
  prisma.backfillJob.count({ where: { shopDomain, status: { in: ["queued", "processing"] } } });

export const describeBackfill = (shopDomain: string) =>
  prisma.backfillJob.findFirst({
    where: { shopDomain, status: { in: ["queued", "processing"] } },
    orderBy: { createdAt: "desc" },
  });

export const startBackfill = async (
  admin: { graphql: (query: string, options: { variables?: Record<string, unknown> }) => Promise<Response> },
  shopDomain: string,
  range: DateRange,
  settings: SettingsDefaults,
  options?: { maxOrders?: number; maxDurationMs?: number },
) => {
  if (!shopDomain) return { queued: false, reason: "missing shop domain" } as const;

  const existing = await prisma.backfillJob.findFirst({
    where: { shopDomain, status: { in: ["queued", "processing"] } },
  });
  if (existing) {
    return { queued: false, reason: "in-flight" } as const;
  }

  const job = await prisma.backfillJob.create({
    data: { shopDomain, range: range.label },
  });

  payloads.set(job.id, { range, settings, admin, options });
  void processQueue();

  return { queued: true as const };
};
