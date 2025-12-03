import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { logger } from "../lib/logger.server";
import { markShopUninstalled } from "../lib/billing.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  let shop = "";
  let topic = "";

  try {
    const { shop: webhookShop, session, topic: webhookTopic, payload } = await authenticate.webhook(request);
    shop = webhookShop;
    topic = webhookTopic;
    const obj = payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
    const payloadShop = typeof obj["shop_domain"] === "string" ? (obj["shop_domain"] as string) : undefined;
    const shopDomain = typeof shop === "string" && shop ? shop : (payloadShop || "");

    logger.info(`Received ${topic} webhook`, { shopDomain: shopDomain || shop, topic });

    // Webhook requests can trigger multiple times and after an app has already been uninstalled.
    // If this webhook already ran, the session may have been deleted previously.
    if (session || shopDomain) {
      const domain = shopDomain || shop;
      await markShopUninstalled(domain);
      
      // We do NOT wipe shop data here, as we want to retain historical analysis data
      // in case the merchant reinstalls (per design doc v0.1).
      // However, we should clean up sessions to force re-authentication.
      try {
        if (domain) {
             await prisma.session.deleteMany({ where: { shop: domain } });
        }
      } catch (e) {
          logger.warn("Failed to clean up sessions on uninstall", { shopDomain: domain, error: (e as Error).message });
      }
    }

    return new Response();
  } catch (error) {
    logger.error("app/uninstalled webhook failed", { shopDomain: shop, topic }, {
      message: (error as Error).message,
    });

    return new Response(undefined, { status: 500 });
  }
};
