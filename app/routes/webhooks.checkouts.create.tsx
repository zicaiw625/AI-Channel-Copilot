import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { logger } from "../lib/logger.server";
import { getSettings } from "../lib/settings.server";
import { processCheckoutCreate, type CheckoutPayload } from "../lib/funnelService.server";
import { enforceRateLimit, RateLimitRules, buildRateLimitKey } from "../lib/security/rateLimit.server";

// 可恢复的错误类型（这些错误可以通过重试解决）
const RECOVERABLE_ERRORS = [
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "P2024", // Prisma 连接超时
  "P2028", // Prisma 事务超时
];

function isRecoverableError(error: Error): boolean {
  const message = error.message || "";
  return RECOVERABLE_ERRORS.some(code => message.includes(code));
}

/**
 * Webhook handler for checkouts/create
 * 处理结账创建事件，用于漏斗归因分析
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  let shop = "";
  
  try {
    const authResult = await authenticate.webhook(request);
    shop = authResult.shop;
    const { topic, payload } = authResult;

    logger.info("[webhook] checkouts/create received", { shop, topic });

    if (!shop) {
      logger.warn("[webhook] Missing shop in checkouts/create");
      return new Response("Missing shop", { status: 400 });
    }

    // 应用速率限制
    try {
      await enforceRateLimit(
        buildRateLimitKey("webhook", "checkout", shop),
        RateLimitRules.WEBHOOK
      );
    } catch (rateLimitError) {
      if (rateLimitError instanceof Response && rateLimitError.status === 429) {
        logger.warn("[webhook] Checkout rate limit exceeded", { shop });
        return new Response("Rate limit exceeded", { status: 429 });
      }
      throw rateLimitError;
    }

    const checkoutPayload = payload as CheckoutPayload;
    
    if (!checkoutPayload?.id) {
      logger.warn("[webhook] Invalid checkout payload", { shop });
      // 无效 payload 是不可恢复的，返回 200 避免重试
      return new Response("Invalid payload", { status: 200 });
    }

    // 获取店铺设置用于 AI 归因
    const settings = await getSettings(shop);
    
    // 处理 checkout 创建
    await processCheckoutCreate(shop, checkoutPayload, {
      aiDomains: settings.aiDomains,
      utmSources: settings.utmSources,
      utmMediumKeywords: settings.utmMediumKeywords,
    });

    logger.info("[webhook] checkouts/create processed", { 
      shop, 
      checkoutId: checkoutPayload.id,
    });

    return new Response("OK", { status: 200 });
  } catch (error) {
    const err = error as Error;
    
    logger.error("[webhook] checkouts/create error", { shop }, {
      error: err.message,
      stack: err.stack,
      recoverable: isRecoverableError(err),
    });
    
    // 对于可恢复的错误，返回 500 让 Shopify 重试
    if (isRecoverableError(err)) {
      return new Response("Temporary error, please retry", { status: 500 });
    }
    
    // 对于不可恢复的错误，返回 200 避免无限重试
    return new Response("Error", { status: 200 });
  }
};
