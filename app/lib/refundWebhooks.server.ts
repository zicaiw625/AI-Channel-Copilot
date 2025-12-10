import { authenticate } from "../shopify.server";
import { fetchOrderById } from "./shopifyOrders.server";
import { persistOrders } from "./persistence.server";
import { getSettings } from "./settings.server";
import { isDemoMode } from "./runtime.server";
import { logger } from "./logger.server";

type RefundWebhookPayload = {
  id?: unknown;
  order_id?: unknown;
  admin_graphql_api_order_id?: unknown;
};

const normalizeOrderGid = (value: unknown): string | null => {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return `gid://shopify/Order/${value}`;
  return null;
};

const extractOrderGidFromRefund = (payload: Record<string, unknown>): string | null => {
  const typed = payload as RefundWebhookPayload;
  // Refund payload has order_id, not id (id is the refund's own ID)
  return (
    normalizeOrderGid(typed.admin_graphql_api_order_id) ||
    normalizeOrderGid(typed.order_id) ||
    null
  );
};

export const handleRefundWebhook = async (request: Request) => {
  let shopDomain = "";

  try {
    if (isDemoMode()) {
      logger.info("[webhook] demo mode enabled; ignoring refund webhook");
      return new Response();
    }

    const { admin, shop, topic, payload } = await authenticate.webhook(request);
    shopDomain = shop;
    const webhookPayload = (payload || {}) as Record<string, unknown>;

    logger.info("[webhook] received refund", { shopDomain: shop, topic });

    if (topic !== "refunds/create") {
      logger.warn("[webhook] unexpected topic for refund handler", { shopDomain: shop, topic });
      return new Response("Topic mismatch", { status: 400 });
    }

    if (!admin || !shop) {
      logger.warn("[webhook] admin client unavailable for refund processing", { shopDomain: shop });
      return new Response("Admin client unavailable", { status: 500 });
    }

    const orderGid = extractOrderGidFromRefund(webhookPayload);

    if (!orderGid) {
      logger.warn("[webhook] missing order_id in refund payload", { shopDomain: shop, payload: JSON.stringify(webhookPayload).slice(0, 200) });
      return new Response("Missing order_id in refund payload", { status: 400 });
    }

    const settings = await getSettings(shop);

    // Fetch the updated order to get the new refund total
    const record = await fetchOrderById(admin, orderGid, settings, {
      shopDomain: shop,
    });

    if (!record) {
      logger.warn("[webhook] order not found for refund", { shopDomain: shop, orderGid });
      return new Response("Order not found", { status: 404 });
    }

    // Persist the updated order with new refund total
    await persistOrders(shop, [record]);

    logger.info("[webhook] refund processed, order updated", {
      shopDomain: shop,
      orderId: record.id,
      refundTotal: record.refundTotal,
    });

    return new Response();
  } catch (error) {
    // Re-throw Response objects (e.g., 401 from HMAC validation failure)
    if (error instanceof Response) {
      throw error;
    }
    logger.error("Refund webhook handler failed", {
      shop: shopDomain,
      message: (error as Error).message,
    });
    return new Response("Webhook processing failed", { status: 500 });
  }
};
