import { registerWebhooks } from "../shopify.server";

export const ensureWebhooks = async (session: unknown) => {
  try {
    await (registerWebhooks as unknown as (arg?: unknown) => Promise<unknown>)({ session });
  } catch {}
};

