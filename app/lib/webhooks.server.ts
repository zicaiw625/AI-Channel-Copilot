import { registerWebhooks } from "../shopify.server";
import { logger } from "./logger.server";

/**
 * 确保Shopify webhooks已正确注册
 * @param session Shopify会话对象 (需要有 shop 属性)
 * @throws {Error} 当webhook注册失败时抛出错误
 */
export const ensureWebhooks = async (session: Parameters<typeof registerWebhooks>[0]["session"]): Promise<void> => {
  if (!session?.shop) {
    const error = new Error("Invalid session: missing shop domain");
    logger.error("[webhook] Invalid session provided", undefined, {
      sessionId: session?.id,
      hasShop: !!session?.shop
    });
    throw error;
  }

  try {
    await registerWebhooks({ session });
    logger.info("[webhook] Webhooks registered successfully", { shop: session.shop });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error("[webhook] registerWebhooks failed", {
      shop: session.shop,
      errorType: error instanceof Error ? error.constructor.name : typeof error
    }, {
      message: errorMessage,
      stack: error instanceof Error ? error.stack : undefined
    });
    throw new Error(`Failed to register webhooks for shop ${session.shop}: ${errorMessage}`);
  }
};
