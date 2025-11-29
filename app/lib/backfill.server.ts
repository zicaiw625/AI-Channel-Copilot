import type { SettingsDefaults } from "./aiData";
import { fetchOrdersForRange } from "./shopifyOrders.server";
import type { DateRange } from "./aiData";
import { markActivity } from "./settings.server";
import { persistOrders } from "./persistence.server";
import prisma from "../db.server";

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

  void (async () => {
    try {
      await prisma.backfillJob.update({
        where: { id: job.id },
        data: { status: "processing", startedAt: new Date() },
      });

      const fetched = await fetchOrdersForRange(
        admin,
        range,
        settings,
        { shopDomain, intent: "manual-backfill", rangeLabel: range.label },
        options,
      );

      if (fetched.orders.length > 0) {
        await persistOrders(shopDomain, fetched.orders);
        await markActivity(shopDomain, { lastBackfillAt: new Date() });
      }

      await prisma.backfillJob.update({
        where: { id: job.id },
        data: {
          status: "completed",
          finishedAt: new Date(),
          ordersFetched: fetched.orders.length,
        },
      });
    } catch (error) {
      console.error("[backfill] background job failed", {
        shopDomain,
        message: (error as Error).message,
      });
      await prisma.backfillJob.update({
        where: { id: job.id },
        data: { status: "failed", finishedAt: new Date(), error: (error as Error).message },
      });
    }
  })();

  return { queued: true as const };
};
