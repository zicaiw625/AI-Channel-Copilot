import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { wipeShopData } from "../lib/gdpr.server";
import { logger } from "../lib/logger.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  let shop = "";
  let topic = "";

  try {
    const { shop: webhookShop, topic: webhookTopic, payload } = await authenticate.webhook(request);
    shop = webhookShop;
    topic = webhookTopic;
    const webhookPayload =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {};

    logger.info(`Received ${topic} webhook`, { shopDomain: shop, topic });

    const shopDomain =
      typeof webhookPayload.shop_domain === "string" && webhookPayload.shop_domain
        ? webhookPayload.shop_domain
        : shop;
    if (!shopDomain) return new Response();

    await wipeShopData(shopDomain);
  } catch (error) {
    logger.error(
      "shop/redact failed",
      { shopDomain: shop || (error as any)?.shop_domain, topic },
      { message: (error as Error).message },
    );

    return new Response(undefined, { status: 500 });
  }

  return new Response();
};
