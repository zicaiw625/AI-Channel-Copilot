import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getSettings } from "../lib/settings.server";
import { fetchOrderById } from "../lib/shopifyOrders.server";
import { persistOrders } from "../lib/persistence.server";
import { applyAiTags } from "../lib/tagging.server";
import { markActivity } from "../lib/settings.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, shop, topic } = await authenticate.webhook(request);
  const payload = await request.json();

  console.log(`Received ${topic} webhook for ${shop}`);

  if (!admin) {
    return new Response("Admin client unavailable", { status: 202 });
  }

  const orderGid =
    payload?.admin_graphql_api_id ||
    (payload?.id ? `gid://shopify/Order/${payload.id}` : null);

  if (!orderGid) {
    return new Response("Missing order id", { status: 400 });
  }

  const settings = await getSettings(shop);
  const record = await fetchOrderById(admin, orderGid, settings);

  if (!record) return new Response();

  await persistOrders(shop, [record]);
  await markActivity(shop, { lastOrdersWebhookAt: new Date() });

  if (record.aiSource && (settings.tagging.writeOrderTags || settings.tagging.writeCustomerTags)) {
    await applyAiTags(admin, [record], settings);
  }

  return new Response();
};
