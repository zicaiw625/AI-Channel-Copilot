import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { logger } from "../lib/logger.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  let shopDomain = "";
  let topic = "";

  try {
    const { payload, session, topic: webhookTopic, shop } = await authenticate.webhook(request);
    shopDomain = shop;
    topic = webhookTopic;
    logger.info(`Received ${topic} webhook`, { shopDomain: shop, topic });

    const currentRaw = (payload as { current?: unknown }).current;
    const current = Array.isArray(currentRaw)
      ? currentRaw.filter((value): value is string => typeof value === "string")
      : [];

    if (current.length) {
      const newScope = current.join(",");
      
      // 更新 webhook 认证返回的 session（可能是 online session）
      if (session) {
        await db.session.update({
          where: { id: session.id },
          data: { scope: newScope },
        });
        logger.info("[scopes_update] Updated webhook session", { 
          shopDomain, 
          sessionId: session.id,
          newScope 
        });
      }

      // 【重要】同时更新 offline session，确保后台任务能获取正确的权限
      const offlineSessionId = `offline_${shopDomain}`;
      try {
        const offlineSession = await db.session.findUnique({
          where: { id: offlineSessionId },
        });

        if (offlineSession) {
          await db.session.update({
            where: { id: offlineSessionId },
            data: { scope: newScope },
          });
          logger.info("[scopes_update] Updated offline session", { 
            shopDomain, 
            sessionId: offlineSessionId,
            oldScope: offlineSession.scope,
            newScope 
          });
        }
      } catch (offlineError) {
        // 如果 offline session 不存在，忽略错误
        logger.warn("[scopes_update] Could not update offline session", { 
          shopDomain, 
          offlineSessionId 
        });
      }
    }

    return new Response();
  } catch (error) {
    // Re-throw Response objects (e.g., 401 from HMAC validation failure)
    if (error instanceof Response) {
      throw error;
    }
    logger.error("app/scopes_update webhook failed", { shopDomain, topic }, {
      message: (error as Error).message,
    });
    return new Response(undefined, { status: 500 });
  }
};
