import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { wipeShopData } from "../lib/gdpr.server";
import { logger } from "../lib/logger.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  let shop = "";

  try {
    const { shop: webhookShop, session, topic, payload } = await authenticate.webhook(request);
    shop = webhookShop;
    const shopDomain = shop || (payload as Record<string, unknown> | null)?.shop_domain;

    logger.info(`Received ${topic} webhook`, { shopDomain: shopDomain || shop, topic });

    // Webhook requests can trigger multiple times and after an app has already been uninstalled.
    // If this webhook already ran, the session may have been deleted previously.
    if (session || shopDomain) {
      await wipeShopData(shopDomain || shop);
    }

    return new Response();
  } catch (error) {
    logger.error("app/uninstalled webhook failed", { shopDomain: shop, topic }, {
      message: (error as Error).message,
    });

    return new Response(undefined, { status: 202 });
  }
};
