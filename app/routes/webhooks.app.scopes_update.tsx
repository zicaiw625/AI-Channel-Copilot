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

    if (session && current.length) {
      await db.session.update({
        where: {
          id: session.id,
        },
        data: {
          scope: current.toString(),
        },
      });
    }

    return new Response();
  } catch (error) {
    logger.error("app/scopes_update webhook failed", { shopDomain, topic }, {
      message: (error as Error).message,
    });
    return new Response(undefined, { status: 202 });
  }
};
