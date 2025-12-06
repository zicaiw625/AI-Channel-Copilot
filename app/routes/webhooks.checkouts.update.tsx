import type { ActionFunctionArgs } from "react-router";
import { handleCheckoutUpdateWebhook } from "../lib/checkoutWebhooks.server";

/**
 * Webhook handler for checkouts/update
 * 处理结账更新事件，异步入队追踪结账完成和放弃
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  return handleCheckoutUpdateWebhook(request);
};
