import type { ActionFunctionArgs } from "react-router";
import { handleRefundWebhook } from "../lib/refundWebhooks.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  return handleRefundWebhook(request);
};
