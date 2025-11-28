import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { wipeShopData } from "../lib/gdpr.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  const payload = await request.json().catch(() => null);

  console.log(`Received ${topic} webhook for ${shop}`);

  const shopDomain = (payload as any)?.shop_domain || shop;
  if (!shopDomain) return new Response();

  try {
    await wipeShopData(shopDomain);
  } catch (error) {
    console.error("shop/redact failed", {
      shop: shopDomain,
      message: (error as Error).message,
    });
  }

  return new Response();
};
