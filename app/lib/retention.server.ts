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
 * 分批删除无订单关联的过期客户
 * @returns 删除的客户总数
 */
const deleteOrphanCustomersInBatches = async (
  shopDomain: string, 
  cutoff: Date
): Promise<number> => {
  let totalDeleted = 0;
  let batchCount = 0;
  
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
  if (!shopDomain) return { deletedOrders: 0, deletedCustomers: 0, cutoff: null };

  const cutoff = computeCutoff(months);
  const startTime = Date.now();
  
  try {
    // 分批删除订单（OrderProduct 通过级联删除）
    const deletedOrders = await deleteOrdersInBatches(shopDomain, cutoff);
    
    // 分批删除无订单关联的过期客户
    const deletedCustomers = await deleteOrphanCustomersInBatches(shopDomain, cutoff);

    await markActivity(shopDomain, { lastCleanupAt: new Date() });

    const elapsedMs = Date.now() - startTime;
    
    logger.info("[retention] cleanup complete", {
      platform,
      shopDomain,
      cutoff: cutoff.toISOString(),
      retentionMonths: months,
      deletedOrders,
      deletedCustomers,
      elapsedMs,
      jobType: "retention",
    });

    return { cutoff, deletedOrders, deletedCustomers };
  } catch (error) {
    logger.warn("[retention] cleanup skipped (table or connection issue)", { 
      platform, 
      shopDomain 
    }, { 
      message: (error as Error).message 
    });
    return { cutoff, deletedOrders: 0, deletedCustomers: 0 };
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
