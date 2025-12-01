import prisma from "../db.server";
import { logger } from "./logger.server";
import { Prisma } from "@prisma/client";

export const withAdvisoryLock = async (key: number, fn: () => Promise<void>) => {
  try {
    const acquired = await prisma.$queryRaw<{ locked: boolean }[]>(
      Prisma.sql`SELECT pg_try_advisory_lock(${key}) AS locked`,
    );
    const ok = acquired[0]?.locked === true;
    if (!ok) return;
    try {
      await fn();
    } finally {
      try {
        await prisma.$queryRaw(Prisma.sql`SELECT pg_advisory_unlock(${key})`);
      } catch (e) {
        logger.warn("[locks] advisory unlock failed", undefined, { message: (e as Error).message });
      }
    }
  } catch (error) {
    logger.warn("[locks] advisory lock unavailable", undefined, { message: (error as Error).message });
    await fn();
  }
};
