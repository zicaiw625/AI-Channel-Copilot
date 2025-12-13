import prisma from "../db.server";
import { getSettings } from "./settings.server";
import { ensureRetentionOncePerDay } from "./retention.server";
import { resolveDateRange } from "./aiData";
import { BACKFILL_COOLDOWN_MINUTES, MAX_BACKFILL_DURATION_MS, MAX_BACKFILL_ORDERS } from "./constants";
import { startBackfill, processBackfillQueue } from "./backfill.server";
import { unauthenticated } from "../shopify.server";
import { logger } from "./logger.server";
import { readAppFlags } from "./env.server";

let initialized = false;

const runRetentionSweep = async () => {
  try {
    const shops = await prisma.shopSettings.findMany({ select: { shopDomain: true } });
    for (const shop of shops) {
      const settings = await getSettings(shop.shopDomain);
      await ensureRetentionOncePerDay(shop.shopDomain, settings);
    }
  } catch (error) {
    logger.warn("[scheduler] retention sweep skipped", undefined, { message: (error as Error).message });
  }
};

const runBackfillSweep = async () => {
  if (!readAppFlags().enableBackfillSweep) return;
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
          async () => {
            let resolvedAdmin: { graphql: (query: string, options: { variables?: Record<string, unknown> }) => Promise<Response> } | null = null;
            try {
              const unauthResult = await unauthenticated.admin(shopDomain);
              // 尝试直接使用返回值，或者从返回值中获取 admin
              if (unauthResult && typeof (unauthResult as any).graphql === "function") {
                resolvedAdmin = unauthResult as any;
              } else if (unauthResult && typeof (unauthResult as any).admin?.graphql === "function") {
                resolvedAdmin = (unauthResult as any).admin;
              }
            } catch {
              resolvedAdmin = null;
            }
            return { admin: resolvedAdmin, settings };
          },
          { shopDomain },
        );
    }
  } catch (error) {
    logger.warn("[scheduler] backfill sweep skipped", undefined, { message: (error as Error).message });
  }
};

export const initScheduler = () => {
  if (initialized) return;
  initialized = true;
  if (!readAppFlags().enableRetentionSweep) {
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
