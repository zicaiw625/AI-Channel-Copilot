import prisma from "../db.server";
import { getSettings } from "./settings.server";
import { ensureRetentionOncePerDay } from "./retention.server";

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

export const initScheduler = () => {
  if (initialized) return;
  initialized = true;
  if (process.env.ENABLE_RETENTION_SWEEP === "0") {
    return;
  }
  setTimeout(() => {
    void runRetentionSweep();
  }, 10000);
  setInterval(() => {
    void runRetentionSweep();
  }, 60 * 60 * 1000);
};
