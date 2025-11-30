import prisma from "../db.server";
import { getSettings } from "./settings.server";
import { ensureRetentionOncePerDay } from "./retention.server";

let initialized = false;

const runRetentionSweep = async () => {
  const shops = await prisma.shopSettings.findMany({ select: { shopDomain: true } });
  for (const shop of shops) {
    const settings = await getSettings(shop.shopDomain);
    await ensureRetentionOncePerDay(shop.shopDomain, settings);
  }
};

export const initScheduler = () => {
  if (initialized) return;
  initialized = true;
  setTimeout(() => {
    void runRetentionSweep();
  }, 10000);
  setInterval(() => {
    void runRetentionSweep();
  }, 60 * 60 * 1000);
};

