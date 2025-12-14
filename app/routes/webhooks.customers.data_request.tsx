import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  collectCustomerData,
  describeCustomerFootprint,
  extractGdprIdentifiers,
} from "../lib/gdpr.server";
import { logger } from "../lib/logger.server";

const jsonResponse = (payload: Record<string, unknown>) =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

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

    if (!shop) {
      // 不可恢复：返回 200 避免 Shopify 重试风暴
      return jsonResponse({ ok: false, message: "Missing shop domain" });
    }

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
    // Re-throw Response objects (e.g., 401 from HMAC validation failure)
    if (error instanceof Response) {
      throw error;
    }
    logger.error("customers/data_request failed", { shopDomain: shop, topic }, {
      message: (error as Error).message,
    });
    return new Response(
      JSON.stringify({ ok: false, message: "Internal error" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
};
