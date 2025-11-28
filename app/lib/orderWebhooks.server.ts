import { authenticate } from "../shopify.server";
import { applyAiTags } from "./tagging.server";
import { fetchOrderById } from "./shopifyOrders.server";
import { persistOrders } from "./persistence.server";
import { getSettings, markActivity, updatePipelineStatuses } from "./settings.server";

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

export const handleOrderWebhook = async (request: Request, expectedTopic: string) => {
  let shopDomain = "";

  try {
    const { admin, shop, topic } = await authenticate.webhook(request);
    shopDomain = shop;
    const payload = await request.json().catch(() => null);

    console.log(`Received ${topic} webhook for ${shop}`);

    if (!admin || !shop) {
      await setWebhookStatus(shop, "warning", "Admin client unavailable for webhook processing");
      return new Response("Admin client unavailable", { status: 202 });
    }

    const orderGid =
      payload?.admin_graphql_api_id ||
      (payload?.id ? `gid://shopify/Order/${payload.id}` : null);

    if (!orderGid) {
      await setWebhookStatus(shop, "warning", "Missing order id in webhook payload");
      return new Response("Missing order id", { status: 200 });
    }

    const settings = await getSettings(shop);
    const record = await fetchOrderById(admin, orderGid, settings);

    if (!record) return new Response();

    await persistOrders(shop, [record]);
    await markActivity(shop, { lastOrdersWebhookAt: new Date() });

    if (record.aiSource && (settings.tagging.writeOrderTags || settings.tagging.writeCustomerTags)) {
      try {
        await applyAiTags(admin, [record], settings);
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
      }
    }

    await setWebhookStatus(
      shop,
      "healthy",
      `Received ${expectedTopic} at ${new Date().toISOString()}`,
    );
    return new Response();
  } catch (error) {
    console.error("Order webhook handler failed", {
      topic: expectedTopic,
      shop: shopDomain,
      message: (error as Error).message,
    });
    if (shopDomain) {
      await setWebhookStatus(
        shopDomain,
        "warning",
        "Webhook errored; Shopify retry suppressed, check server logs.",
      );
    }
    return new Response(undefined, { status: 202 });
  }
};
