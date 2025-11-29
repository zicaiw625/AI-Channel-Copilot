import { authenticate } from "../shopify.server";
import { applyAiTags } from "./tagging.server";
import { fetchOrderById } from "./shopifyOrders.server";
import { persistOrders } from "./persistence.server";
import { getSettings, markActivity, updatePipelineStatuses } from "./settings.server";
import { getPlatform, isDemoMode } from "./runtime.server";
import { enqueueWebhookJob, getWebhookQueueSize } from "./webhookQueue.server";

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

type OrderWebhookPayload = {
  admin_graphql_api_id?: unknown;
  id?: unknown;
};

const normalizeOrderGid = (value: unknown): string | null => {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return `gid://shopify/Order/${value}`;
  return null;
};

const extractOrderGid = (payload: Record<string, unknown>): string | null => {
  const typed = payload as OrderWebhookPayload;
  return (
    normalizeOrderGid(typed.admin_graphql_api_id) ||
    normalizeOrderGid(typed.id) ||
    null
  );
};

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

    const orderGid = extractOrderGid(webhookPayload);

    if (!orderGid) {
      await setWebhookStatus(shop, "warning", "Missing order id in webhook payload");
      return new Response("Missing order id", { status: 400 });
    }

    const settings = await getSettings(shop);

    enqueueWebhookJob({
      shopDomain: shop,
      topic,
      intent: expectedTopic,
      run: async () => {
        const record = await fetchOrderById(admin, orderGid, settings, { shopDomain: shop });

        if (!record) {
          await setWebhookStatus(shop, "warning", "Order not found for webhook payload");
          return;
        }

        await persistOrders(shop, [record]);
        await markActivity(shop, { lastOrdersWebhookAt: new Date() });

        console.info("[webhook] order persisted", {
          platform,
          shop,
          orderId: record.id,
          aiSource: record.aiSource,
          detection: record.detection?.slice(0, 160),
          signals: record.signals?.slice(0, 5),
          intent: expectedTopic,
        });

        await setWebhookStatus(
          shop,
          "healthy",
          `Processed ${expectedTopic} at ${new Date().toISOString()}`,
        );

        if (record.aiSource && (settings.tagging.writeOrderTags || settings.tagging.writeCustomerTags)) {
          const taggingStart = Date.now();
          try {
            await applyAiTags(admin, [record], settings, { shopDomain: shop, intent: expectedTopic });
            await markActivity(shop, { lastTaggingAt: new Date() });
            await setWebhookStatus(shop, "healthy", "Latest order tagged successfully.");
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
          } finally {
            const elapsed = Date.now() - taggingStart;
            if (elapsed > 4500) {
              console.warn("[webhook] tagging exceeded threshold", {
                platform,
                shop,
                elapsedMs: elapsed,
                topic,
              });
            }
          }
        }
      },
    });

    await setWebhookStatus(
      shop,
      "info",
      `Queued ${expectedTopic} (${getWebhookQueueSize()} in-flight)`,
    );

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
