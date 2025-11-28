import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { wipeShopData } from "../lib/gdpr.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  let shop = "";

  try {
    const { shop: webhookShop, topic, payload } = await authenticate.webhook(request);
    shop = webhookShop;
    const webhookPayload = (payload || {}) as Record<string, unknown>;

    console.log(`Received ${topic} webhook for ${shop}`);

    const shopDomain = (webhookPayload as any)?.shop_domain || shop;
    if (!shopDomain) return new Response();

    await wipeShopData(shopDomain);
  } catch (error) {
    console.error("shop/redact failed", {
      shop: shop || (error as any)?.shop_domain,
      message: (error as Error).message,
    });

    return new Response(undefined, { status: 202 });
  }

  return new Response();
};
