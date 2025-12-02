import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { redactCustomerRecords, extractGdprIdentifiers } from "../lib/gdpr.server";
import { logger } from "../lib/logger.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  let shop = "";
  let topic = "";

  try {
    const { shop: webhookShop, topic: webhookTopic, payload } = await authenticate.webhook(request);
    shop = webhookShop;
    topic = webhookTopic;
    const source = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};

    logger.info(`Received ${topic} webhook`, { shopDomain: shop, topic });

    if (!shop) return new Response();

    const { customerIds, orderIds, customerEmail } = extractGdprIdentifiers(source);
    const extraOrders = Array.isArray((source as Record<string, unknown>)?.orders_to_redact)
      ? ((source as Record<string, unknown>).orders_to_redact as unknown[])
      : [];
    const normalize = (values: unknown[], resource: "Customer" | "Order") => {
      const set = new Set<string>();
      values.forEach((value) => {
        if (value === undefined || value === null) return;
        const raw = String(value).trim();
        if (!raw) return;
        if (raw.startsWith("gid://")) {
          set.add(raw);
        } else {
          set.add(`gid://shopify/${resource}/${raw}`);
        }
      });
      return Array.from(set);
    };
    const mergedOrderIds = Array.from(new Set([...
      orderIds,
      ...normalize(extraOrders, "Order"),
    ]));
    if (!customerIds.length && !mergedOrderIds.length && customerEmail) {
      logger.info("customers/redact received email only; no persisted customer ids to delete", {
        shopDomain: shop,
        topic,
      });
    }
    await redactCustomerRecords(shop, customerIds, mergedOrderIds);
  } catch (error) {
    logger.error("customers/redact failed", { shopDomain: shop, topic }, {
      message: (error as Error).message,
    });

    return new Response(undefined, { status: 500 });
  }

  return new Response();
};
