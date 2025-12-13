import prisma from "../db.server";
import { logger } from "./logger.server";
import { readCriticalEnv } from "./env.server";

let ran = false;

export const runStartupSelfCheck = () => {
  if (ran) return;
  ran = true;
  try {
    const env = readCriticalEnv();
    logger.info("[startup] SCOPES configured", { scopes: env.SCOPES.join(",") });
  } catch (error) {
    throw error as Error;
  }
  setTimeout(async () => {
    try {
      await prisma.$connect();
      logger.info("[startup] database connectivity OK");
    } catch (error) {
      if (process.env.NODE_ENV === "production") {
        logger.error("[startup] database connectivity failed", undefined, { message: (error as Error).message });
      } else {
        logger.warn("[startup] database connectivity failed (non-fatal in dev/test)", undefined, {
          message: (error as Error).message,
        });
      }
    }
  }, 0);
};
