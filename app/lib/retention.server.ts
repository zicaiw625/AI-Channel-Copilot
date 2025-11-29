import prisma from "../db.server";
import { defaultSettings, type SettingsDefaults } from "./aiData";
import { getPlatform } from "./runtime.server";
import { markActivity } from "./settings.server";

const platform = getPlatform();

const parseEnvRetention = () => {
  const value = process.env.DATA_RETENTION_MONTHS;
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
};

export const resolveRetentionMonths = (settings?: SettingsDefaults) => {
  const candidate = settings?.retentionMonths || parseEnvRetention() || defaultSettings.retentionMonths || 6;
  return Math.max(1, Math.floor(candidate));
};

const computeCutoff = (months: number) => {
  const now = new Date();
  now.setMonth(now.getMonth() - months);
  return now;
};

export const pruneHistoricalData = async (shopDomain: string, months: number) => {
  if (!shopDomain) return { deletedOrders: 0, deletedCustomers: 0, cutoff: null };

  const cutoff = computeCutoff(months);

  const [deletedOrders, deletedCustomers] = await Promise.all([
    prisma.order.deleteMany({ where: { shopDomain, createdAt: { lt: cutoff } } }),
    prisma.customer.deleteMany({
      where: { shopDomain, updatedAt: { lt: cutoff }, orders: { none: {} } },
    }),
  ]);

  await markActivity(shopDomain, { lastCleanupAt: new Date() });

  console.info("[retention] cleanup complete", {
    platform,
    shop: shopDomain,
    cutoff: cutoff.toISOString(),
    deletedOrders: deletedOrders.count,
    deletedCustomers: deletedCustomers.count,
  });

  return { cutoff, deletedOrders: deletedOrders.count, deletedCustomers: deletedCustomers.count };
};

export const ensureRetentionOncePerDay = async (shopDomain: string, settings?: SettingsDefaults) => {
  const retentionMonths = resolveRetentionMonths(settings);
  const lastCleanup = settings?.lastCleanupAt ? new Date(settings.lastCleanupAt) : null;
  const now = new Date();
  if (lastCleanup && now.getTime() - lastCleanup.getTime() < 24 * 60 * 60 * 1000) {
    return { skipped: true, reason: "recent-cleanup", lastCleanupAt: lastCleanup.toISOString() };
  }

  const result = await pruneHistoricalData(shopDomain, retentionMonths);
  return { skipped: false, ...result };
};
