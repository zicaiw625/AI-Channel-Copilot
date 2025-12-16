import prisma from "../db.server";
import { getSettings } from "./settings.server";
import { ensureRetentionOncePerDay } from "./retention.server";
import { resolveDateRange } from "./aiData";
import { BACKFILL_COOLDOWN_MINUTES, MAX_BACKFILL_DURATION_MS, MAX_BACKFILL_ORDERS } from "./constants";
import { startBackfill, processBackfillQueue, cleanupStaleBackfillJobs } from "./backfill.server";
import { unauthenticated } from "../shopify.server";
import { logger } from "./logger.server";
import { readAppFlags } from "./env.server";
import { withAdvisoryLock } from "./locks.server";
import { wakeupDueWebhookJobs } from "./webhookQueue.server";

// 锁 ID 常量（需要在整个应用中唯一）
const SCHEDULER_LOCK_RETENTION = 2001;
const SCHEDULER_LOCK_BACKFILL = 2002;
const SCHEDULER_LOCK_WEBHOOK_WAKEUP = 2003;
const SCHEDULER_LOCK_BACKFILL_CLEANUP = 2004;

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
 * 🆕 Webhook 队列唤醒任务
 * 扫描并唤醒 DB 中 due 的任务，解决进程重启后 setTimeout 丢失的问题
 * 使用分布式锁确保多实例部署时只有一个实例执行
 */
const runWebhookWakeup = async () => {
  const { lockInfo } = await withAdvisoryLock(SCHEDULER_LOCK_WEBHOOK_WAKEUP, async () => {
    try {
      const result = await wakeupDueWebhookJobs();
      if (result.shopsWoken > 0) {
        logger.info("[scheduler] Webhook wakeup completed", { shopsWoken: result.shopsWoken });
      }
    } catch (error) {
      logger.warn("[scheduler] Webhook wakeup failed", undefined, { message: (error as Error).message });
    }
  });

  if (!lockInfo.acquired) {
    logger.debug("[scheduler] Webhook wakeup skipped (another instance is running)");
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

/**
 * 清理超时的补拉任务
 * 使用分布式锁确保多实例部署时只有一个实例执行
 */
const runBackfillCleanup = async () => {
  const { lockInfo } = await withAdvisoryLock(SCHEDULER_LOCK_BACKFILL_CLEANUP, async () => {
    try {
      const cleaned = await cleanupStaleBackfillJobs();
      if (cleaned > 0) {
        logger.info("[scheduler] Backfill cleanup completed", { cleanedJobs: cleaned });
      }
    } catch (error) {
      logger.warn("[scheduler] Backfill cleanup failed", undefined, { message: (error as Error).message });
    }
  });

  if (!lockInfo.acquired) {
    logger.debug("[scheduler] Backfill cleanup skipped (another instance is running)");
  }
};

export const initScheduler = () => {
  if (initialized) return;
  initialized = true;
  
  // 🆕 Webhook 队列唤醒扫描器：每 30 秒检查一次
  // 这个扫描器不依赖 enableRetentionSweep，始终启用
  // 解决进程重启后 setTimeout 丢失导致的任务卡死问题
  setTimeout(() => {
    void runWebhookWakeup();
  }, 5000); // 启动后 5 秒执行第一次
  setInterval(() => {
    void runWebhookWakeup();
  }, 30 * 1000); // 每 30 秒执行一次

  // 🆕 超时补拉任务清理：每 2 分钟检查一次
  // 始终启用，清理卡住超过 BACKFILL_TIMEOUT_MINUTES 的任务
  setTimeout(() => {
    void runBackfillCleanup();
  }, 15000); // 启动后 15 秒执行第一次
  setInterval(() => {
    void runBackfillCleanup();
  }, 2 * 60 * 1000); // 每 2 分钟执行一次
  
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
