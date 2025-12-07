import { authenticate, unauthenticated } from "../shopify.server";
import { applyAiTags } from "./tagging.server";
import { fetchOrderById } from "./shopifyOrders.server";
import { persistOrders } from "./persistence.server";
import { getSettings, markActivity, updatePipelineStatuses } from "./settings.server";
import { getPlatform, isDemoMode } from "./runtime.server";
import { enqueueWebhookJob, getWebhookQueueSize, registerWebhookHandler, checkWebhookDuplicate } from "./webhookQueue.server";
import { logger } from "./logger.server";
import { enforceRateLimit, RateLimitRules, buildRateLimitKey } from "./security/rateLimit.server";

const WEBHOOK_STATUS_TITLE = "orders/create webhook";

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

    if (index >= 0) {
      // 保持原有 title，只更新 status 和 detail
      nextStatuses[index] = { ...nextStatuses[index], status, detail };
      return nextStatuses;
    }

    // 如果不存在，使用标准 title 创建新条目
    return [{ title: WEBHOOK_STATUS_TITLE, status, detail }, ...nextStatuses];
  });
};

const TAGGING_STATUS_TITLE = "AI tagging write-back";

const setTaggingStatus = async (
  shopDomain: string,
  status: "healthy" | "warning" | "info",
  detail: string,
) => {
  if (!shopDomain) return;
  await updatePipelineStatuses(shopDomain, (statuses) => {
    const nextStatuses = [...statuses];
    const index = nextStatuses.findIndex((item) =>
      item.title.toLowerCase().includes("tagging") || item.title.toLowerCase().includes("tag"),
    );

    if (index >= 0) {
      nextStatuses[index] = { ...nextStatuses[index], status, detail };
      return nextStatuses;
    }

    return [...nextStatuses, { title: TAGGING_STATUS_TITLE, status, detail }];
  });
};

const platform = getPlatform();

type OrderWebhookPayload = {
  admin_graphql_api_id?: unknown;
  id?: unknown;
  order_id?: unknown;
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
    normalizeOrderGid(typed.order_id) ||
    null
  );
};

export const handleOrderWebhook = async (request: Request, expectedTopic: string) => {
  let shopDomain = "";

  try {
    if (isDemoMode()) {
      logger.info("[webhook] demo mode enabled; ignoring webhook", { platform, expectedTopic });
      return new Response();
    }

    const { admin, shop, topic, payload } = await authenticate.webhook(request);
    shopDomain = shop;
    const webhookPayload = (payload || {}) as Record<string, unknown>;

    logger.info("[webhook] received", { shopDomain: shop, topic });

    // 应用速率限制（店铺级别）
    // 注意：Shopify 会重试失败的 webhook，所以我们不抛出 429，而是记录警告
    try {
      await enforceRateLimit(
        buildRateLimitKey("webhook", shop, topic),
        RateLimitRules.WEBHOOK
      );
    } catch (rateLimitError) {
      if (rateLimitError instanceof Response && rateLimitError.status === 429) {
        logger.warn("[webhook] Rate limit exceeded, returning 429 for retry", {
          shopDomain: shop,
          topic,
        });
        // 返回 429 让 Shopify 延迟重试
        return new Response("Rate limit exceeded", { status: 429 });
      }
      throw rateLimitError;
    }

    if (topic !== expectedTopic) {
      await setWebhookStatus(shop, "warning", `Unexpected topic ${topic}`);
      return new Response("Topic mismatch", { status: 400 });
    }

    if (!admin || !shop) {
      await setWebhookStatus(shop, "warning", "Admin client unavailable for webhook processing");
      return new Response("Admin client unavailable", { status: 500 });
    }

    const orderGid = extractOrderGid(webhookPayload);

    if (!orderGid) {
      await setWebhookStatus(shop, "warning", "Missing order id in webhook payload");
      return new Response("Missing order id", { status: 400 });
    }

    // 🆕 早期去重检查：在入队前检查 X-Shopify-Webhook-Id（Shopify 最佳实践）
    const externalId = request.headers.get("X-Shopify-Webhook-Id") || request.headers.get("x-shopify-webhook-id") || null;
    const triggeredAt = request.headers.get("X-Shopify-Triggered-At") || request.headers.get("x-shopify-triggered-at") || null;
    const eventTime = triggeredAt ? new Date(triggeredAt) : null;

    if (externalId) {
      const isDuplicate = await checkWebhookDuplicate(shop, topic, externalId);
      if (isDuplicate) {
        logger.info("[webhook] Duplicate ignored by X-Shopify-Webhook-Id (early check)", {
          shopDomain: shop,
          topic,
          externalId,
        });
        // 返回 200 告诉 Shopify 已处理，避免重试
        return new Response("Duplicate", { status: 200 });
      }
    }

    const handler = async (jobPayload: Record<string, unknown>) => {
      const jobOrderGid = jobPayload.orderGid as string;
      const jobShopDomain = (jobPayload.shopDomain as string) || shop;
      const settings = await getSettings(jobShopDomain);

      const record = await fetchOrderById(admin, jobOrderGid, settings, {
        shopDomain: jobShopDomain,
      });

      if (!record) {
        await setWebhookStatus(jobShopDomain, "warning", "Order not found for webhook payload");
        return;
      }

      await persistOrders(jobShopDomain, [record]);
      await markActivity(jobShopDomain, { lastOrdersWebhookAt: new Date() });

      logger.info("[webhook] order persisted", {
        platform,
        shop: jobShopDomain,
        orderId: record.id,
        aiSource: record.aiSource,
        detection: record.detection?.slice(0, 160),
        signals: record.signals?.slice(0, 5),
        referrer: record.referrer || null,
        utmSource: record.utmSource || null,
        utmMedium: record.utmMedium || null,
        intent: expectedTopic,
      });

      await setWebhookStatus(
        jobShopDomain,
        "healthy",
        `Processed ${expectedTopic} at ${new Date().toISOString()}`,
      );

      if (record.aiSource && (settings.tagging.writeOrderTags || settings.tagging.writeCustomerTags)) {
        const taggingStart = Date.now();
        try {
          await applyAiTags(admin, [record], settings, { shopDomain: jobShopDomain, intent: expectedTopic });
          await markActivity(jobShopDomain, { lastTaggingAt: new Date() });
          await setTaggingStatus(jobShopDomain, "healthy", `Last run at ${new Date().toISOString()}`);
        } catch (error) {
          logger.error("applyAiTags failed", {
            shop: jobShopDomain,
            topic,
            message: (error as Error).message,
          });
          await setTaggingStatus(
            jobShopDomain,
            "warning",
            "Tagging failed; check server logs and retry later.",
          );
        } finally {
          const elapsed = Date.now() - taggingStart;
          if (elapsed > 4500) {
            logger.warn("[webhook] tagging exceeded threshold", {
              platform,
              shop: jobShopDomain,
              elapsedMs: elapsed,
              topic,
            });
          }
        }
      }
    };

    if (process.env.NODE_ENV === "test") {
      await handler({ orderGid, shopDomain: shop });
      await setWebhookStatus(shop, "info", `Processed ${expectedTopic} in test mode`);
      return new Response();
    }

    // externalId 和 eventTime 已在上方早期去重检查时提取
    await enqueueWebhookJob({
      shopDomain: shop,
      topic,
      intent: expectedTopic,
      payload: { orderGid, shopDomain: shop },
      externalId,
      orderId: orderGid,
      eventTime,
      run: handler,
    });

    await setWebhookStatus(
      shop,
      "info",
      `Queued ${expectedTopic} (${await getWebhookQueueSize()} in-flight)`,
    );

    return new Response();
  } catch (error) {
    // Re-throw Response objects (e.g., 401 from HMAC validation failure)
    if (error instanceof Response) {
      throw error;
    }
    logger.error("Order webhook handler failed", {
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

export const registerDefaultOrderWebhookHandlers = () => {
  const intents = ["orders/create", "orders/updated"] as const;
  intents.forEach((intent) => {
    registerWebhookHandler(intent, async (jobPayload: Record<string, unknown>) => {
      const jobOrderGid = jobPayload.orderGid as string | undefined;
      const jobShopDomain = jobPayload.shopDomain as string | undefined;
      if (!jobOrderGid || !jobShopDomain) {
        logger.warn("[webhook] default handler missing identifiers", undefined, {
          orderGid: jobOrderGid || null,
          shopDomain: jobShopDomain || null,
        });
        return;
      }

      const settings = await getSettings(jobShopDomain);
      let client: unknown = null;
      try {
        client = await unauthenticated.admin(jobShopDomain);
      } catch {
        client = null;
      }
      const adminCandidate = (client as { graphql?: unknown }) || null;
      const admin = adminCandidate && typeof adminCandidate.graphql === "function"
        ? (adminCandidate as {
            graphql: (
              query: string,
              options: { variables?: Record<string, unknown> }
            ) => Promise<Response>;
          })
        : null;

      if (!admin) {
        logger.warn("[webhook] default handler admin unavailable", { shopDomain: jobShopDomain });
        return;
      }

      const record = await fetchOrderById(admin, jobOrderGid, settings, { shopDomain: jobShopDomain });
      if (!record) {
        logger.warn("[webhook] default handler order not found", { shopDomain: jobShopDomain });
        return;
      }

      await persistOrders(jobShopDomain, [record]);
      await markActivity(jobShopDomain, { lastOrdersWebhookAt: new Date() });

      if (record.aiSource && (settings.tagging.writeOrderTags || settings.tagging.writeCustomerTags)) {
        try {
          await applyAiTags(admin, [record], settings, { shopDomain: jobShopDomain, intent });
          await markActivity(jobShopDomain, { lastTaggingAt: new Date() });
          await setTaggingStatus(jobShopDomain, "healthy", `Last run at ${new Date().toISOString()}`);
        } catch (error) {
          logger.error("applyAiTags failed", { shop: jobShopDomain, intent }, {
            message: (error as Error).message,
          });
          await setTaggingStatus(jobShopDomain, "warning", "Tagging failed; check logs.");
        }
      }
    });
  });
};
