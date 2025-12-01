import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { redactCustomerRecords } from "../lib/gdpr.server";
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

    if (!shop) return new Response();

    const source = webhookPayload as Record<string, unknown>;
    const toIds = (values: unknown[], resource: "Customer" | "Order") => {
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

    const customerIds = toIds(
      [
        (source as any)?.customer_id,
        (source as any)?.customerId,
        (source as any)?.customer?.id,
      ],
      "Customer",
    );

    const orderIds = toIds(
      [
        ...((Array.isArray((source as any)?.orders_to_redact) ? (source as any).orders_to_redact : []) as unknown[]),
        ...((Array.isArray((source as any)?.orders_requested) ? (source as any).orders_requested : []) as unknown[]),
      ],
      "Order",
    );

    const customerEmail = (source as any)?.customer_email || (source as any)?.email || (source as any)?.customer?.email;
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
