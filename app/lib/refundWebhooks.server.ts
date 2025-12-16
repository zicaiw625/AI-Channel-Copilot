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
      // 不可恢复：返回 200 避免 Shopify 重试风暴
      return new Response("Topic mismatch (ignored)", { status: 200 });
    }

    if (!admin || !shop) {
      logger.warn("[webhook] admin client unavailable for refund processing", { shopDomain: shop });
      // 多发生于卸载后 session 被清理等场景，重试通常无意义；避免重试风暴
      return new Response("Admin client unavailable (ignored)", { status: 200 });
    }

    const orderGid = extractOrderGidFromRefund(webhookPayload);

    if (!orderGid) {
      // 仅记录安全的诊断字段，不打印原始 payload 以避免隐私泄露
      const refundId = typeof webhookPayload.id === "number" || typeof webhookPayload.id === "string" 
        ? String(webhookPayload.id) 
        : "unknown";
      logger.warn("[webhook] missing order_id in refund payload", { 
        shopDomain: shop, 
        refundId,
        hasOrderId: "order_id" in webhookPayload,
        hasAdminGid: "admin_graphql_api_order_id" in webhookPayload,
      });
      // 不可恢复：返回 200 避免 Shopify 重试
      return new Response("Missing order_id (ignored)", { status: 200 });
    }

    const settings = await getSettings(shop);

    // Fetch the updated order to get the new refund total
    const { order: record, error: fetchError } = await fetchOrderById(admin, orderGid, settings, {
      shopDomain: shop,
    });

    if (!record) {
      // 【修复】记录具体错误原因
      if (fetchError) {
        logger.warn("[webhook] order fetch failed for refund", { 
          shopDomain: shop, 
          orderGid,
          errorCode: fetchError.code,
          errorMessage: fetchError.message,
          suggestReauth: fetchError.suggestReauth,
        });
      } else {
        logger.warn("[webhook] order not found for refund", { shopDomain: shop, orderGid });
      }
      // 不可恢复：订单不存在/不可访问时不应触发重试风暴
      return new Response("Order not found (ignored)", { status: 200 });
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
