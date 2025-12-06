import type { ActionFunctionArgs } from "react-router";
import { handleCheckoutCreateWebhook } from "../lib/checkoutWebhooks.server";

/**
 * Webhook handler for checkouts/create
 * 处理结账创建事件，异步入队进行漏斗归因分析
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  return handleCheckoutCreateWebhook(request);
};
