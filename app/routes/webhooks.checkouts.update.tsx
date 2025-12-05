import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { logger } from "../lib/logger.server";
import { getSettings } from "../lib/settings.server";
import { processCheckoutUpdate, type CheckoutPayload } from "../lib/funnelService.server";

/**
 * Webhook handler for checkouts/update
 * 处理结账更新事件，用于追踪结账完成和放弃
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { shop, topic, payload } = await authenticate.webhook(request);

    logger.info("[webhook] checkouts/update received", { shop, topic });

    if (!shop) {
      logger.warn("[webhook] Missing shop in checkouts/update");
      return new Response("Missing shop", { status: 400 });
    }

    const checkoutPayload = payload as CheckoutPayload;
    
    if (!checkoutPayload?.id) {
      logger.warn("[webhook] Invalid checkout payload", { shop });
      return new Response("Invalid payload", { status: 400 });
    }

    // 获取店铺设置用于 AI 归因
    const settings = await getSettings(shop);
    
    // 处理 checkout 更新
    await processCheckoutUpdate(shop, checkoutPayload, {
      aiDomains: settings.aiDomains,
      utmSources: settings.utmSources,
      utmMediumKeywords: settings.utmMediumKeywords,
    });

    logger.info("[webhook] checkouts/update processed", { 
      shop, 
      checkoutId: checkoutPayload.id,
      completed: Boolean(checkoutPayload.completed_at),
    });

    return new Response("OK", { status: 200 });
  } catch (error) {
    logger.error("[webhook] checkouts/update error", {}, {
      error: (error as Error).message,
      stack: (error as Error).stack,
    });
    
    return new Response("Error", { status: 200 });
  }
};
