import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getSettings } from "../lib/settings.server";
import { processCheckoutUpdate, type CheckoutPayload } from "../lib/funnelService.server";
import { enforceRateLimit, RateLimitRules, buildRateLimitKey } from "../lib/security/rateLimit.server";
import {
  handleWebhookError,
  webhookSuccess,
  webhookRateLimited,
  webhookNonRetryableError,
  webhookBadRequest,
  logWebhookReceived,
  logWebhookProcessed,
} from "../lib/webhookUtils.server";
import { logger } from "../lib/logger.server";

const WEBHOOK_TYPE = "checkouts/update";

/**
 * Webhook handler for checkouts/update
 * 处理结账更新事件，用于追踪结账完成和放弃
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  let shop = "";
  
  try {
    const authResult = await authenticate.webhook(request);
    shop = authResult.shop;
    const { topic, payload } = authResult;

    logWebhookReceived(WEBHOOK_TYPE, shop, topic);

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
        logger.warn("[webhook] Checkout update rate limit exceeded", { shop });
        return webhookRateLimited();
      }
      throw rateLimitError;
    }

    const checkoutPayload = payload as CheckoutPayload;
    
    if (!checkoutPayload?.id) {
      logger.warn("[webhook] Invalid checkout payload", { shop });
      return webhookNonRetryableError("Invalid payload");
    }

    // 获取店铺设置用于 AI 归因
    const settings = await getSettings(shop);
    
    // 处理 checkout 更新
    await processCheckoutUpdate(shop, checkoutPayload, {
      aiDomains: settings.aiDomains,
      utmSources: settings.utmSources,
      utmMediumKeywords: settings.utmMediumKeywords,
    });

    logWebhookProcessed(WEBHOOK_TYPE, shop, { 
      checkoutId: checkoutPayload.id,
      completed: Boolean(checkoutPayload.completed_at),
    });

    return webhookSuccess();
  } catch (error) {
    return handleWebhookError(error as Error, {
      shop,
      topic: WEBHOOK_TYPE,
      webhookType: WEBHOOK_TYPE,
    });
  }
};
