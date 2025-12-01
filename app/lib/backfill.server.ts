import type { Prisma } from "@prisma/client";
import type { SettingsDefaults, DateRange } from "./aiData";
import { fetchOrdersForRange } from "./shopifyOrders.server";
import { markActivity } from "./settings.server";
import { persistOrders } from "./persistence.server";
import prisma from "../db.server";
import { withAdvisoryLock } from "./locks.server";
import { logger } from "./logger.server";
import { MAX_BACKFILL_DURATION_MS, MAX_BACKFILL_ORDERS } from "./constants";

type BackfillDependencies = {
  settings: SettingsDefaults | null;
  admin:
    | { graphql: (query: string, options: { variables?: Record<string, unknown> }) => Promise<Response> }
    | null;
};

let processing = false;

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
  if (processing) return;
  processing = true;

  try {
    await withAdvisoryLock(1002, async () => {
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
      }
    }
    });
  } finally {
    processing = false;
    const pending = await prisma.backfillJob.count({ where: { status: "queued", ...where } });
    if (pending) void processQueue(resolveDependencies, where);
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
  shopDomain: string,
  range: DateRange,
  options?: { maxOrders?: number; maxDurationMs?: number },
) => {
  if (!shopDomain) return { queued: false, reason: "missing shop domain" } as const;

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
