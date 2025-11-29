import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { wipeShopData } from "../lib/gdpr.server";
import { logger } from "../lib/logger.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  let shop = "";

  try {
    const { shop: webhookShop, topic, payload } = await authenticate.webhook(request);
    shop = webhookShop;
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
      { shopDomain: shop || (error as { shop_domain?: string } | Error)?.shop_domain, topic },
      { message: (error as Error).message },
    );

    return new Response(undefined, { status: 202 });
  }

  return new Response();
};
