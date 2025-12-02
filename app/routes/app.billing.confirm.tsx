import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { hasActiveSubscription } from "../lib/billing.server";
import type { AdminGraphqlClient } from "../lib/billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session?.shop || "";
  const planName = process.env.BILLING_PLAN_NAME || "AI Channel Copilot Basic";
  const ok = await hasActiveSubscription(admin as AdminGraphqlClient, planName);
  if (ok) {
    throw new Response(null, { status: 302, headers: { Location: "/app" } });
  }
  throw new Response(null, { status: 302, headers: { Location: "/app/billing" } });
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
