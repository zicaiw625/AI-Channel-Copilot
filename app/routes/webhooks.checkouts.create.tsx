import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { logger } from "../lib/logger.server";
import { getSettings } from "../lib/settings.server";
import { processCheckoutCreate, type CheckoutPayload } from "../lib/funnelService.server";

/**
 * Webhook handler for checkouts/create
 * 处理结账创建事件，用于漏斗归因分析
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { shop, topic, payload } = await authenticate.webhook(request);

    logger.info("[webhook] checkouts/create received", { shop, topic });

    if (!shop) {
      logger.warn("[webhook] Missing shop in checkouts/create");
      return new Response("Missing shop", { status: 400 });
    }

    const checkoutPayload = payload as CheckoutPayload;
    
    if (!checkoutPayload?.id) {
      logger.warn("[webhook] Invalid checkout payload", { shop });
      return new Response("Invalid payload", { status: 400 });
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
    logger.error("[webhook] checkouts/create error", {}, {
      error: (error as Error).message,
      stack: (error as Error).stack,
    });
    
    // Return 200 to avoid Shopify retry for non-recoverable errors
    return new Response("Error", { status: 200 });
  }
};
