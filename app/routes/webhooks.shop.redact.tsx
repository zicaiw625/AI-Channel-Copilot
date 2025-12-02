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
    const shopFromError = (() => {
      const obj = error && typeof error === "object" && !Array.isArray(error)
        ? (error as Record<string, unknown>)
        : {};
      const val = obj["shop_domain"];
      return typeof val === "string" ? (val as string) : undefined;
    })();

    logger.error(
      "shop/redact failed",
      { shopDomain: shop || shopFromError, topic },
      { message: (error as Error).message },
    );

    return new Response(undefined, { status: 500 });
  }

  return new Response();
};
