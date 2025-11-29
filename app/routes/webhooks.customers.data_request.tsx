import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  collectCustomerData,
  describeCustomerFootprint,
  extractGdprIdentifiers,
} from "../lib/gdpr.server";

const jsonResponse = (payload: Record<string, unknown>) =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

export const action = async ({ request }: ActionFunctionArgs) => {
  let shop = "";

  try {
    const { shop: webhookShop, topic, payload } = await authenticate.webhook(request);
    shop = webhookShop;
    const webhookPayload =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {};

    console.log(`Received ${topic} webhook for ${shop}`);

    if (!shop) return jsonResponse({ ok: true, message: "Missing shop domain" });

    const { customerIds, customerEmail, orderIds } = extractGdprIdentifiers(webhookPayload);
    const footprint = await describeCustomerFootprint(shop, customerIds);
    if (!footprint.hasData) {
      return jsonResponse({
        ok: true,
        message: customerEmail
          ? "No customer-level data stored for this shop; customer emails are not persisted."
          : "No customer-level data stored for this shop; nothing to export.",
      });
    }

    const exportData = await collectCustomerData(shop, customerIds, orderIds);

    return jsonResponse({
      ok: true,
      message: `Stored ${footprint.orders} orders / ${footprint.customers} customer rows linked to this customer. No personal data beyond Shopify IDs, referrers, and landing pages is persisted.`,
      export: {
        generatedAt: new Date().toISOString(),
        shop,
        customerEmail,
        customerIds,
        orders: exportData.orders,
        customers: exportData.customers,
      },
    });
  } catch (error) {
    console.error("customers/data_request failed", {
      shop,
      message: (error as Error).message,
    });
    return jsonResponse({
      ok: true,
      message: "No customer-level data stored; nothing to export.",
    });
  }
};
