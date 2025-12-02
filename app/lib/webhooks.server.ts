import { registerWebhooks } from "../shopify.server";
import { logger } from "./logger.server";

type RegisterWebhooksArgs = { session: unknown };

export const ensureWebhooks = async (session: unknown) => {
  try {
    await (registerWebhooks as (args: RegisterWebhooksArgs) => Promise<unknown>)({ session });
  } catch (error) {
    logger.error("[webhook] registerWebhooks failed", undefined, { message: (error as Error).message });
    throw error;
  }
};
