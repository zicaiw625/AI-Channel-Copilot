import prisma from "../db.server";
import { defaultSettings, type SettingsDefaults } from "./aiData";
import { getPlatform } from "./runtime.server";
import { markActivity } from "./settings.server";
import { 
  DEFAULT_RETENTION_MONTHS, 
  RETENTION_DELETE_BATCH_SIZE, 
  RETENTION_DELETE_BATCH_DELAY_MS 
} from "./constants";
import { logger } from "./logger.server";
import { readAppFlags, readIntegerEnv } from "./env.server";

const platform = getPlatform();

/**
 * 🔒 WebhookJob 保留天数
 * 较短的 TTL 是因为 WebhookJob payload 可能包含敏感数据
 * 任务完成后无需长期保留
 */
const WEBHOOK_JOB_RETENTION_DAYS = 7;

const parseEnvRetention = () => {
  const parsed = readIntegerEnv("DATA_RETENTION_MONTHS", undefined, 1);
  return parsed ?? null;
};

export const resolveRetentionMonths = (settings?: SettingsDefaults) => {
  const candidate =
    settings?.retentionMonths || parseEnvRetention() || defaultSettings.retentionMonths || DEFAULT_RETENTION_MONTHS;
  return Math.max(3, Math.floor(candidate));
};

const computeCutoff = (months: number) => {
  const now = new Date();
  now.setMonth(now.getMonth() - months);
  return now;
};

/**
 * 分批删除订单，避免长时间锁表
 * @returns 删除的订单总数
 */
const deleteOrdersInBatches = async (
  shopDomain: string, 
  cutoff: Date
): Promise<number> => {
  let totalDeleted = 0;
  let batchCount = 0;
  
  // eslint-disable-next-line no-constant-condition -- 分批处理循环，通过 break 退出
  while (true) {
    // 先查询要删除的订单 ID
    const ordersToDelete = await prisma.order.findMany({
      where: { shopDomain, createdAt: { lt: cutoff } },
      select: { id: true },
      take: RETENTION_DELETE_BATCH_SIZE,
    });
    
    if (ordersToDelete.length === 0) {
      break;
    }
    
    const orderIds = ordersToDelete.map(o => o.id);
    
    // 批量删除（OrderProduct 会通过 onDelete: Cascade 自动删除）
    const result = await prisma.order.deleteMany({
      where: { id: { in: orderIds } },
    });
    
    totalDeleted += result.count;
    batchCount++;
    
    logger.debug("[retention] batch deleted orders", {
      shopDomain,
      batch: batchCount,
      batchSize: result.count,
      totalDeleted,
    });
    
    // 如果删除的数量小于批次大小，说明已经删完了
    if (ordersToDelete.length < RETENTION_DELETE_BATCH_SIZE) {
      break;
    }
    
    // 批次间短暂延迟，释放数据库资源
    await new Promise(resolve => setTimeout(resolve, RETENTION_DELETE_BATCH_DELAY_MS));
  }
  
  return totalDeleted;
};

/**
 * 🔒 删除过期的 WebhookJob 记录
 * 这是 GDPR 合规的关键：WebhookJob.payload 可能包含客户 PII
 * 
 * @param shopDomain - 店铺域名
 * @param retentionDays - 保留天数（默认 7 天）
 * @returns 删除的任务数
 */
const deleteExpiredWebhookJobs = async (
  shopDomain: string,
  retentionDays: number = WEBHOOK_JOB_RETENTION_DAYS
): Promise<number> => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  
  let totalDeleted = 0;
  let batchCount = 0;
  
  // eslint-disable-next-line no-constant-condition -- 分批处理循环，通过 break 退出
  while (true) {
    // 查询要删除的 WebhookJob ID（已完成或失败且超过 TTL）
    const jobsToDelete = await prisma.webhookJob.findMany({
      where: {
        shopDomain,
        createdAt: { lt: cutoff },
        // 只删除已终结的任务，避免删除正在处理中的任务
        status: { in: ["completed", "failed"] },
      },
      select: { id: true },
      take: RETENTION_DELETE_BATCH_SIZE,
    });
    
    if (jobsToDelete.length === 0) {
      break;
    }
    
    const jobIds = jobsToDelete.map(j => j.id);
    
    const result = await prisma.webhookJob.deleteMany({
      where: { id: { in: jobIds } },
    });
    
    totalDeleted += result.count;
    batchCount++;
    
    logger.debug("[retention] batch deleted webhook jobs", {
      shopDomain,
      batch: batchCount,
      batchSize: result.count,
      totalDeleted,
    });
    
    if (jobsToDelete.length < RETENTION_DELETE_BATCH_SIZE) {
      break;
    }
    
    await new Promise(resolve => setTimeout(resolve, RETENTION_DELETE_BATCH_DELAY_MS));
  }
  
  return totalDeleted;
};

/**
 * 分批删除无订单关联的过期客户
 * @returns 删除的客户总数
 */
const deleteOrphanCustomersInBatches = async (
  shopDomain: string, 
  cutoff: Date
): Promise<number> => {
  let totalDeleted = 0;
  let batchCount = 0;
  
  // eslint-disable-next-line no-constant-condition -- 分批处理循环，通过 break 退出
  while (true) {
    // 查询要删除的客户 ID（无订单关联且已过期）
    const customersToDelete = await prisma.customer.findMany({
      where: { 
        shopDomain, 
        updatedAt: { lt: cutoff }, 
        orders: { none: {} } 
      },
      select: { id: true },
      take: RETENTION_DELETE_BATCH_SIZE,
    });
    
    if (customersToDelete.length === 0) {
      break;
    }
    
    const customerIds = customersToDelete.map(c => c.id);
    
    // 批量删除
    const result = await prisma.customer.deleteMany({
      where: { id: { in: customerIds } },
    });
    
    totalDeleted += result.count;
    batchCount++;
    
    logger.debug("[retention] batch deleted customers", {
      shopDomain,
      batch: batchCount,
      batchSize: result.count,
      totalDeleted,
    });
    
    // 如果删除的数量小于批次大小，说明已经删完了
    if (customersToDelete.length < RETENTION_DELETE_BATCH_SIZE) {
      break;
    }
    
    // 批次间短暂延迟
    await new Promise(resolve => setTimeout(resolve, RETENTION_DELETE_BATCH_DELAY_MS));
  }
  
  return totalDeleted;
};

export const pruneHistoricalData = async (shopDomain: string, months: number) => {
  if (!shopDomain) return { deletedOrders: 0, deletedCustomers: 0, deletedCheckouts: 0, deletedSessions: 0, deletedEvents: 0, deletedWebhookJobs: 0, cutoff: null };

  const cutoff = computeCutoff(months);
  const startTime = Date.now();
  
  try {
    // 分批删除订单（OrderProduct 通过级联删除）
    const deletedOrders = await deleteOrdersInBatches(shopDomain, cutoff);
    
    // 分批删除无订单关联的过期客户
    const deletedCustomers = await deleteOrphanCustomersInBatches(shopDomain, cutoff);
    
    // 🔒 清理过期的 WebhookJob（GDPR 合规：payload 可能包含 PII）
    const deletedWebhookJobs = await deleteExpiredWebhookJobs(shopDomain);
    
    // 清理漏斗相关数据（Checkout 仅存 hasEmail 布尔值，无 PII）
    const [checkoutResult, sessionResult, eventResult] = await Promise.all([
      prisma.checkout.deleteMany({
        where: { shopDomain, createdAt: { lt: cutoff } },
      }),
      prisma.visitorSession.deleteMany({
        where: { shopDomain, createdAt: { lt: cutoff } },
      }),
      prisma.funnelEvent.deleteMany({
        where: { shopDomain, createdAt: { lt: cutoff } },
      }),
    ]);
    
    const deletedCheckouts = checkoutResult.count;
    const deletedSessions = sessionResult.count;
    const deletedEvents = eventResult.count;

    await markActivity(shopDomain, { lastCleanupAt: new Date() });

    const elapsedMs = Date.now() - startTime;
    
    logger.info("[retention] cleanup complete", {
      platform,
      shopDomain,
      cutoff: cutoff.toISOString(),
      retentionMonths: months,
      deletedOrders,
      deletedCustomers,
      deletedCheckouts,
      deletedSessions,
      deletedEvents,
      deletedWebhookJobs,  // 🔒 新增
      elapsedMs,
      jobType: "retention",
    });

    return { cutoff, deletedOrders, deletedCustomers, deletedCheckouts, deletedSessions, deletedEvents, deletedWebhookJobs };
  } catch (error) {
    logger.warn("[retention] cleanup skipped (table or connection issue)", { 
      platform, 
      shopDomain 
    }, { 
      message: (error as Error).message 
    });
    return { cutoff, deletedOrders: 0, deletedCustomers: 0, deletedCheckouts: 0, deletedSessions: 0, deletedEvents: 0, deletedWebhookJobs: 0 };
  }
};

export const ensureRetentionOncePerDay = async (shopDomain: string, settings?: SettingsDefaults) => {
  if (!readAppFlags().enableRetentionSweep) {
    return { skipped: true, reason: "disabled", lastCleanupAt: settings?.lastCleanupAt || null };
  }
  const retentionMonths = resolveRetentionMonths(settings);
  const lastCleanup = settings?.lastCleanupAt ? new Date(settings.lastCleanupAt) : null;
  const now = new Date();
  if (lastCleanup && now.getTime() - lastCleanup.getTime() < 24 * 60 * 60 * 1000) {
    return { skipped: true, reason: "recent-cleanup", lastCleanupAt: lastCleanup.toISOString() };
  }

  const result = await pruneHistoricalData(shopDomain, retentionMonths);
  return { skipped: false, ...result };
};
