import type { HeadersFunction, ActionFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate, BILLING_PLAN, login } from "../shopify.server";
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
  } catch (e) {
    const form = await request.formData();
    const url = new URL(request.url);
    const lang = url.searchParams.get("lang") === "en" ? "en" : "zh";
    const nextUrl = new URL(`/auth/login?lang=${lang}`, url.origin);
    const next = new Request(nextUrl.toString(), { method: "POST", body: form, headers: request.headers });
    throw await login(next);
  }
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
