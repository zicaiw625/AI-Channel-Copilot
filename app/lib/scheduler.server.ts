import prisma from "../db.server";
import { getSettings } from "./settings.server";
import { ensureRetentionOncePerDay } from "./retention.server";
import { resolveDateRange } from "./aiData";
import { BACKFILL_COOLDOWN_MINUTES, MAX_BACKFILL_DURATION_MS, MAX_BACKFILL_ORDERS } from "./constants";
import { startBackfill, processBackfillQueue } from "./backfill.server";
import { unauthenticated } from "../shopify.server";

let initialized = false;

const runRetentionSweep = async () => {
  try {
    const shops = await prisma.shopSettings.findMany({ select: { shopDomain: true } });
    for (const shop of shops) {
      const settings = await getSettings(shop.shopDomain);
      await ensureRetentionOncePerDay(shop.shopDomain, settings);
    }
  } catch (error) {
    // Soft-fail if schema/table not ready or DB unavailable
    // eslint-disable-next-line no-console
    console.warn("[scheduler] retention sweep skipped", { message: (error as Error).message });
  }
};

const runBackfillSweep = async () => {
  if (process.env.ENABLE_BACKFILL_SWEEP === "0") return;
  try {
    const shops = await prisma.shopSettings.findMany({ select: { shopDomain: true, timezone: true, lastBackfillAt: true } });
    for (const shop of shops) {
      const shopDomain = shop.shopDomain;
      const settings = await getSettings(shopDomain);
      const timezone = settings.timezones[0] || shop.timezone || "UTC";

      const now = new Date();
      const lastBackfillAt = shop.lastBackfillAt ? new Date(shop.lastBackfillAt) : null;
      const withinCooldown = lastBackfillAt && now.getTime() - lastBackfillAt.getTime() < BACKFILL_COOLDOWN_MINUTES * 60 * 1000;
      if (withinCooldown) continue;

      const range = resolveDateRange("90d", new Date(), undefined, undefined, timezone);

      const existing = await prisma.backfillJob.findFirst({ where: { shopDomain, status: { in: ["queued", "processing"] } } });
      if (!existing) {
        const queued = await startBackfill(shopDomain, range, {
          maxOrders: MAX_BACKFILL_ORDERS,
          maxDurationMs: MAX_BACKFILL_DURATION_MS,
        });
        if (!queued.queued) continue;
      }

      void processBackfillQueue(
        async () => ({
          admin: (await unauthenticated.admin(shopDomain)) as unknown as { graphql: (query: string, options: { variables?: Record<string, unknown> }) => Promise<Response> },
          settings,
        }),
        { shopDomain },
      );
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("[scheduler] backfill sweep skipped", { message: (error as Error).message });
  }
};

export const initScheduler = () => {
  if (initialized) return;
  initialized = true;
  if (process.env.ENABLE_RETENTION_SWEEP === "0") {
    return;
  }
  setTimeout(() => {
    void runRetentionSweep();
    void runBackfillSweep();
  }, 10000);
  setInterval(() => {
    void runRetentionSweep();
    void runBackfillSweep();
  }, 60 * 60 * 1000);
};
