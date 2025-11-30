import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { wipeShopData } from "../lib/gdpr.server";
import { logger } from "../lib/logger.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  let shop = "";
  let topic = "";

  try {
    const { shop: webhookShop, session, topic: webhookTopic, payload } = await authenticate.webhook(request);
    shop = webhookShop;
    topic = webhookTopic;
    const payloadShop = (payload as any)?.shop_domain;
    const shopDomain = typeof shop === "string" && shop ? shop : (typeof payloadShop === "string" ? payloadShop : "");

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
