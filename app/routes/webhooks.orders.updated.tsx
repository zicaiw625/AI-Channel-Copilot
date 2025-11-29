import type { ActionFunctionArgs } from "react-router";
import { handleOrderWebhook } from "../lib/orderWebhooks.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  return handleOrderWebhook(request, "orders/updated");
};
