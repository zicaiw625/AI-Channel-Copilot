import { authenticate } from "../shopify.server";
import { applyAiTags } from "./tagging.server";
import { fetchOrderById } from "./shopifyOrders.server";
import { persistOrders } from "./persistence.server";
import { getSettings, markActivity, updatePipelineStatuses } from "./settings.server";
import { getPlatform, isDemoMode } from "./runtime.server";

const setWebhookStatus = async (
  shopDomain: string,
  status: "healthy" | "warning" | "info",
  detail: string,
) => {
  if (!shopDomain) return;
  await updatePipelineStatuses(shopDomain, (statuses) => {
    const nextStatuses = [...statuses];
    const index = nextStatuses.findIndex((item) =>
      item.title.toLowerCase().includes("webhook"),
    );
    const nextEntry = { title: "orders webhook", status, detail };

    if (index >= 0) {
      nextStatuses[index] = { ...nextStatuses[index], ...nextEntry };
      return nextStatuses;
    }

    return [nextEntry, ...nextStatuses];
  });
};

const platform = getPlatform();

export const handleOrderWebhook = async (request: Request, expectedTopic: string) => {
  let shopDomain = "";

  try {
    if (isDemoMode()) {
      console.info("[webhook] demo mode enabled; ignoring webhook", {
        platform,
        expectedTopic,
      });
      return new Response();
    }

    const { admin, shop, topic, payload } = await authenticate.webhook(request);
    shopDomain = shop;
    const webhookPayload = (payload || {}) as Record<string, unknown>;

    console.log(`Received ${topic} webhook for ${shop}`);

    if (!admin || !shop) {
      await setWebhookStatus(shop, "warning", "Admin client unavailable for webhook processing");
      return new Response("Admin client unavailable", { status: 500 });
    }

    const orderGid =
      (webhookPayload as any)?.admin_graphql_api_id ||
      ((webhookPayload as any)?.id
        ? `gid://shopify/Order/${(webhookPayload as any).id}`
        : null);

    if (!orderGid) {
      await setWebhookStatus(shop, "warning", "Missing order id in webhook payload");
      return new Response("Missing order id", { status: 400 });
    }

    const settings = await getSettings(shop);
    const record = await fetchOrderById(admin, orderGid, settings);

    if (!record) {
      await setWebhookStatus(shop, "warning", "Order not found for webhook payload");
      return new Response("Order not found", { status: 404 });
    }

    await persistOrders(shop, [record]);
    await markActivity(shop, { lastOrdersWebhookAt: new Date() });

    console.info("[webhook] order persisted", {
      platform,
      shop,
      orderId: record.id,
      aiSource: record.aiSource,
      intent: expectedTopic,
    });

    let webhookStatus: { status: "healthy" | "warning" | "info"; detail: string } = {
      status: "healthy",
      detail: `Received ${expectedTopic} at ${new Date().toISOString()}`,
    };

    if (record.aiSource && (settings.tagging.writeOrderTags || settings.tagging.writeCustomerTags)) {
      try {
        await applyAiTags(admin, [record], settings, { shopDomain: shop, intent: expectedTopic });
      } catch (error) {
        console.error("applyAiTags failed", {
          shop,
          topic,
          message: (error as Error).message,
        });
        await setWebhookStatus(
          shop,
          "warning",
          "Tagging failed for latest order; check server logs and retry later.",
        );
        webhookStatus = {
          status: "warning",
          detail: "Tagging failed for latest order; check server logs and retry later.",
        };
      }
    }

    await setWebhookStatus(shop, webhookStatus.status, webhookStatus.detail);
    // Only return 2xx responses after order persistence has completed to allow Shopify to retry
    // any critical failures automatically.
    return new Response();
  } catch (error) {
    console.error("Order webhook handler failed", {
      topic: expectedTopic,
      shop: shopDomain,
      platform,
      message: (error as Error).message,
    });
    if (shopDomain) {
      await setWebhookStatus(
        shopDomain,
        "warning",
        "Webhook errored; Shopify will retry critical failures.",
      );
    }
    return new Response("Webhook processing failed", { status: 500 });
  }
};
