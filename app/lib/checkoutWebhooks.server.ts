/**
 * Checkout Webhook 异步处理器
 * 将 checkout 事件入队到 webhook 队列中异步处理
 */

import { authenticate } from "../shopify.server";
import { getSettings } from "./settings.server";
import { processCheckoutCreate, processCheckoutUpdate, type CheckoutPayload } from "./funnelService.server";
import { enqueueWebhookJob, registerWebhookHandler, checkWebhookDuplicate } from "./webhookQueue.server";
import { logger } from "./logger.server";
import { enforceRateLimit, RateLimitRules, buildRateLimitKey } from "./security/rateLimit.server";
import {
  webhookSuccess,
  webhookBadRequest,
  handleWebhookError,
  logWebhookReceived,
} from "./webhookUtils.server";

/**
 * 处理 checkouts/create webhook
 */
export const handleCheckoutCreateWebhook = async (request: Request) => {
  let shop = "";

  try {
    const authResult = await authenticate.webhook(request);
    shop = authResult.shop;
    const { topic, payload } = authResult;

    logWebhookReceived("checkouts/create", shop, topic);

    if (!shop) {
      logger.warn("[webhook] Missing shop in checkouts/create");
      return webhookBadRequest("Missing shop");
    }

    // 应用速率限制
    try {
      await enforceRateLimit(
        buildRateLimitKey("webhook", "checkout", shop),
        RateLimitRules.WEBHOOK
      );
    } catch (rateLimitError) {
      if (rateLimitError instanceof Response && rateLimitError.status === 429) {
        // Shopify 对非 2xx 会重试；这里不返回 429，避免重试风暴
        logger.warn("[webhook] Checkout rate limit exceeded; accepting webhook and queueing", { shop });
      } else {
        throw rateLimitError;
      }
    }

    const checkoutPayload = payload as CheckoutPayload;

    if (!checkoutPayload?.id) {
      logger.warn("[webhook] Invalid checkout payload", { shop });
      return webhookBadRequest("Invalid payload");
    }

    // 获取 Shopify Webhook ID 用于去重
    const externalId = request.headers.get("X-Shopify-Webhook-Id") || 
                       request.headers.get("x-shopify-webhook-id") || 
                       null;
    const triggeredAt = request.headers.get("X-Shopify-Triggered-At") || 
                        request.headers.get("x-shopify-triggered-at") || 
                        null;
    const eventTime = triggeredAt ? new Date(triggeredAt) : null;

    // 🆕 早期去重检查：在入队前检查 X-Shopify-Webhook-Id（Shopify 最佳实践）
    if (externalId) {
      const isDuplicate = await checkWebhookDuplicate(shop, "checkouts/create", externalId);
      if (isDuplicate) {
        logger.info("[webhook] Duplicate checkout/create ignored by X-Shopify-Webhook-Id", {
          shop,
          externalId,
        });
        return webhookSuccess(); // 返回 200 告诉 Shopify 已处理
      }
    }

    // 入队异步处理
    await enqueueWebhookJob({
      shopDomain: shop,
      topic: "checkouts/create",
      intent: "checkouts/create",
      payload: {
        checkoutId: checkoutPayload.id,
        shopDomain: shop,
        checkoutPayload: checkoutPayload,
      },
      externalId,
      orderId: null, // checkout 没有 orderId
      eventTime,
      run: async (jobPayload) => {
        const jobShop = jobPayload.shopDomain as string;
        const jobCheckoutPayload = jobPayload.checkoutPayload as CheckoutPayload;
        
        const settings = await getSettings(jobShop);
        await processCheckoutCreate(jobShop, jobCheckoutPayload, {
          aiDomains: settings.aiDomains,
          utmSources: settings.utmSources,
          utmMediumKeywords: settings.utmMediumKeywords,
        });
        
        logger.info("[webhook] checkout processed", {
          shop: jobShop,
          checkoutId: jobCheckoutPayload.id,
        });
      },
    });

    return webhookSuccess();
  } catch (error) {
    return handleWebhookError(error as Error, {
      shop,
      topic: "checkouts/create",
      webhookType: "checkouts/create",
    });
  }
};

/**
 * 处理 checkouts/update webhook
 */
export const handleCheckoutUpdateWebhook = async (request: Request) => {
  let shop = "";

  try {
    const authResult = await authenticate.webhook(request);
    shop = authResult.shop;
    const { topic, payload } = authResult;

    logWebhookReceived("checkouts/update", shop, topic);

    if (!shop) {
      logger.warn("[webhook] Missing shop in checkouts/update");
      return webhookBadRequest("Missing shop");
    }

    // 应用速率限制
    try {
      await enforceRateLimit(
        buildRateLimitKey("webhook", "checkout", shop),
        RateLimitRules.WEBHOOK
      );
    } catch (rateLimitError) {
      if (rateLimitError instanceof Response && rateLimitError.status === 429) {
        // Shopify 对非 2xx 会重试；这里不返回 429，避免重试风暴
        logger.warn("[webhook] Checkout rate limit exceeded; accepting webhook and queueing", { shop });
      } else {
      throw rateLimitError;
      }
    }

    const checkoutPayload = payload as CheckoutPayload;

    if (!checkoutPayload?.id) {
      logger.warn("[webhook] Invalid checkout payload", { shop });
      return webhookBadRequest("Invalid payload");
    }

    // 获取 Shopify Webhook ID 用于去重
    const externalId = request.headers.get("X-Shopify-Webhook-Id") || 
                       request.headers.get("x-shopify-webhook-id") || 
                       null;
    const triggeredAt = request.headers.get("X-Shopify-Triggered-At") || 
                        request.headers.get("x-shopify-triggered-at") || 
                        null;
    const eventTime = triggeredAt ? new Date(triggeredAt) : null;

    // 🆕 早期去重检查：在入队前检查 X-Shopify-Webhook-Id（Shopify 最佳实践）
    if (externalId) {
      const isDuplicate = await checkWebhookDuplicate(shop, "checkouts/update", externalId);
      if (isDuplicate) {
        logger.info("[webhook] Duplicate checkout/update ignored by X-Shopify-Webhook-Id", {
          shop,
          externalId,
        });
        return webhookSuccess(); // 返回 200 告诉 Shopify 已处理
      }
    }

    // 入队异步处理
    await enqueueWebhookJob({
      shopDomain: shop,
      topic: "checkouts/update",
      intent: "checkouts/update",
      payload: {
        checkoutId: checkoutPayload.id,
        shopDomain: shop,
        checkoutPayload: checkoutPayload,
      },
      externalId,
      orderId: null,
      eventTime,
      run: async (jobPayload) => {
        const jobShop = jobPayload.shopDomain as string;
        const jobCheckoutPayload = jobPayload.checkoutPayload as CheckoutPayload;
        
        const settings = await getSettings(jobShop);
        await processCheckoutUpdate(jobShop, jobCheckoutPayload, {
          aiDomains: settings.aiDomains,
          utmSources: settings.utmSources,
          utmMediumKeywords: settings.utmMediumKeywords,
        });
        
        logger.info("[webhook] checkout update processed", {
          shop: jobShop,
          checkoutId: jobCheckoutPayload.id,
        });
      },
    });

    return webhookSuccess();
  } catch (error) {
    return handleWebhookError(error as Error, {
      shop,
      topic: "checkouts/update",
      webhookType: "checkouts/update",
    });
  }
};

/**
 * 注册 checkout webhook 处理器
 */
export const registerCheckoutWebhookHandlers = () => {
  registerWebhookHandler("checkouts/create", async (jobPayload) => {
    const jobShop = jobPayload.shopDomain as string;
    const jobCheckoutPayload = jobPayload.checkoutPayload as CheckoutPayload;
    
    if (!jobShop || !jobCheckoutPayload) {
      logger.warn("[webhook] checkout handler missing data", { 
        hasShop: !!jobShop, 
        hasPayload: !!jobCheckoutPayload 
      });
      return;
    }
    
    const settings = await getSettings(jobShop);
    await processCheckoutCreate(jobShop, jobCheckoutPayload, {
      aiDomains: settings.aiDomains,
      utmSources: settings.utmSources,
      utmMediumKeywords: settings.utmMediumKeywords,
    });
  });

  registerWebhookHandler("checkouts/update", async (jobPayload) => {
    const jobShop = jobPayload.shopDomain as string;
    const jobCheckoutPayload = jobPayload.checkoutPayload as CheckoutPayload;
    
    if (!jobShop || !jobCheckoutPayload) {
      logger.warn("[webhook] checkout update handler missing data", { 
        hasShop: !!jobShop, 
        hasPayload: !!jobCheckoutPayload 
      });
      return;
    }
    
    const settings = await getSettings(jobShop);
    await processCheckoutUpdate(jobShop, jobCheckoutPayload, {
      aiDomains: settings.aiDomains,
      utmSources: settings.utmSources,
      utmMediumKeywords: settings.utmMediumKeywords,
    });
  });
};
