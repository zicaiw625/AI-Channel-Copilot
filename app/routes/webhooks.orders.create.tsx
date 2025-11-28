import type { ActionFunctionArgs } from "react-router";
import { handleOrderWebhook } from "../lib/orderWebhooks.server";

export const action = async ({ request }: ActionFunctionArgs) =>
  handleOrderWebhook(request, "orders/create");
