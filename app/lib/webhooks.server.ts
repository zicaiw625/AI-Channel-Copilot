import { registerWebhooks } from "../shopify.server";
import { logger } from "./logger.server";

export const ensureWebhooks = async (session: unknown) => {
  try {
    await (registerWebhooks as unknown as (arg?: unknown) => Promise<unknown>)({ session });
  } catch (error) {
    logger.error("[webhook] registerWebhooks failed", undefined, { message: (error as Error).message });
    throw error;
  }
};
