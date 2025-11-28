import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { extractGdprIdentifiers, redactCustomerRecords } from "../lib/gdpr.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  const payload = await request.json().catch(() => null);

  console.log(`Received ${topic} webhook for ${shop}`);

  if (!shop) return new Response();

  try {
    const { customerIds, orderIds, customerEmail } = extractGdprIdentifiers(payload);
    if (!customerIds.length && !orderIds.length && customerEmail) {
      console.log("customers/redact received email only; no persisted customer ids to delete");
    }
    await redactCustomerRecords(shop, customerIds, orderIds);
  } catch (error) {
    console.error("customers/redact failed", {
      shop,
      message: (error as Error).message,
    });
  }

  return new Response();
};
