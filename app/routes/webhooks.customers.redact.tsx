import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { extractGdprIdentifiers, redactCustomerRecords } from "../lib/gdpr.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  let shop = "";

  try {
    const { shop: webhookShop, topic, payload } = await authenticate.webhook(request);
    shop = webhookShop;
    const webhookPayload = (payload || {}) as Record<string, unknown>;

    console.log(`Received ${topic} webhook for ${shop}`);

    if (!shop) return new Response();

    const { customerIds, orderIds, customerEmail } = extractGdprIdentifiers(webhookPayload);
    if (!customerIds.length && !orderIds.length && customerEmail) {
      console.log("customers/redact received email only; no persisted customer ids to delete");
    }
    await redactCustomerRecords(shop, customerIds, orderIds);
  } catch (error) {
    console.error("customers/redact failed", {
      shop,
      message: (error as Error).message,
    });

    return new Response(undefined, { status: 202 });
  }

  return new Response();
};
