import type { HeadersFunction, ActionFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate, BILLING_PLAN } from "../shopify.server";
import { requireEnv } from "../lib/env.server";
import { computeIsTestMode } from "../lib/billing.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { billing, session } = await authenticate.admin(request);
    const shopDomain = session?.shop || "";
    const isTest = await computeIsTestMode(shopDomain);
    const appUrl = requireEnv("SHOPIFY_APP_URL");
    await billing.request({ plan: BILLING_PLAN, isTest, returnUrl: `${appUrl}/app/billing/confirm` });
    return null;
  } catch (error) {
    if (error instanceof Response) throw error;
    throw error;
  }
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
