import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { extractGdprIdentifiers, redactCustomerRecords } from "../lib/gdpr.server";
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

    if (!shop) return new Response();

    const { customerIds, orderIds, customerEmail } = extractGdprIdentifiers(webhookPayload);
    if (!customerIds.length && !orderIds.length && customerEmail) {
      logger.info("customers/redact received email only; no persisted customer ids to delete", {
        shopDomain: shop,
        topic,
      });
    }
    await redactCustomerRecords(shop, customerIds, orderIds);
  } catch (error) {
    logger.error("customers/redact failed", { shopDomain: shop, topic }, {
      message: (error as Error).message,
    });

    return new Response(undefined, { status: 202 });
  }

  return new Response();
};
