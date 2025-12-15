import prisma from "../db.server";
import { getSettings } from "./settings.server";
import { ensureRetentionOncePerDay } from "./retention.server";
import { resolveDateRange } from "./aiData";
import { BACKFILL_COOLDOWN_MINUTES, MAX_BACKFILL_DURATION_MS, MAX_BACKFILL_ORDERS } from "./constants";
import { startBackfill, processBackfillQueue } from "./backfill.server";
import { unauthenticated } from "../shopify.server";
import { logger } from "./logger.server";
import { readAppFlags } from "./env.server";
import { withAdvisoryLock } from "./locks.server";

// 锁 ID 常量（需要在整个应用中唯一）
const SCHEDULER_LOCK_RETENTION = 2001;
const SCHEDULER_LOCK_BACKFILL = 2002;

let initialized = false;

/**
 * 执行数据保留清理任务
 * 使用分布式锁确保多实例部署时只有一个实例执行
 */
const runRetentionSweep = async () => {
  const { lockInfo } = await withAdvisoryLock(SCHEDULER_LOCK_RETENTION, async () => {
    try {
      logger.info("[scheduler] Starting retention sweep (acquired lock)");
      const shops = await prisma.shopSettings.findMany({ select: { shopDomain: true } });
      for (const shop of shops) {
        const settings = await getSettings(shop.shopDomain);
        await ensureRetentionOncePerDay(shop.shopDomain, settings);
      }
      logger.info("[scheduler] Retention sweep completed", { shopsProcessed: shops.length });
    } catch (error) {
      logger.warn("[scheduler] retention sweep failed", undefined, { message: (error as Error).message });
    }
  });
  
  if (!lockInfo.acquired) {
    logger.debug("[scheduler] Retention sweep skipped (another instance is running)");
  }
};

/**
 * 执行历史订单回填任务
 * 使用分布式锁确保多实例部署时只有一个实例执行
 */
const runBackfillSweep = async () => {
  if (!readAppFlags().enableBackfillSweep) return;
  
  const { lockInfo } = await withAdvisoryLock(SCHEDULER_LOCK_BACKFILL, async () => {
    try {
      logger.info("[scheduler] Starting backfill sweep (acquired lock)");
      const shops = await prisma.shopSettings.findMany({ select: { shopDomain: true, timezone: true, lastBackfillAt: true } });
      let shopsQueued = 0;
      
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
          shopsQueued++;
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
      
      logger.info("[scheduler] Backfill sweep completed", { shopsChecked: shops.length, shopsQueued });
    } catch (error) {
      logger.warn("[scheduler] backfill sweep failed", undefined, { message: (error as Error).message });
    }
  });
  
  if (!lockInfo.acquired) {
    logger.debug("[scheduler] Backfill sweep skipped (another instance is running)");
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
