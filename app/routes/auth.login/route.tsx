import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs, HeadersFunction } from "react-router";
import { useActionData, useLoaderData, useRouteError, Form } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useNonce } from "../../lib/nonce";

import { login } from "../../shopify.server";
import { loginErrorMessage } from "./error.server";
import { requireEnv } from "../../lib/env.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const result = await login(request);
  if (result instanceof Response) throw result;
  const errors = loginErrorMessage(result);
  const url = new URL(request.url);
  const language = url.searchParams.get("lang") === "en" ? "English" : "中文";
  return { errors, language, apiKey: requireEnv("SHOPIFY_API_KEY") };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const result = await login(request);
  if (result instanceof Response) throw result;
  const errors = loginErrorMessage(result);
  const url = new URL(request.url);
  const language = url.searchParams.get("lang") === "en" ? "English" : "中文";
  return {
    errors,
    language,
    apiKey: requireEnv("SHOPIFY_API_KEY"),
  };
};

export default function Auth() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [shop, setShop] = useState("");
  const { errors, language, apiKey } = actionData || loaderData;
  const nonce = useNonce();

  return (
    <AppProvider embedded apiKey={apiKey} nonce={nonce}>
      <div style={{ maxWidth: 400, margin: "40px auto", padding: 20, fontFamily: "system-ui, sans-serif", border: "1px solid #e1e3e5", borderRadius: 8, boxShadow: "0 4px 6px rgba(0,0,0,0.05)" }}>
        <Form method="post" replace>
        <h1 style={{ fontSize: 24, marginBottom: 20 }}>{language === "English" ? "Log in" : "登录"}</h1>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", marginBottom: 8, fontWeight: 600 }}>
              {language === "English" ? "Shop domain" : "店铺域名"}
            </label>
            <input
              name="shop"
              placeholder="example.myshopify.com"
              value={shop}
              onChange={(e) => setShop(e.currentTarget.value)}
              autoComplete="on"
              style={{ width: "100%", padding: "10px", fontSize: 16, border: "1px solid #ccc", borderRadius: 4 }}
            />
            {errors.shop && <div style={{ color: "#d4380d", marginTop: 4, fontSize: 14 }}>{errors.shop}</div>}
          </div>
          <button 
            type="submit"
            style={{ 
              width: "100%", 
              background: "#008060", 
              color: "white", 
              padding: "12px", 
              border: "none", 
              borderRadius: 4, 
              fontSize: 16, 
              fontWeight: 600, 
              cursor: "pointer" 
            }}
          >
            {language === "English" ? "Log in" : "登录"}
          </button>
        </Form>
      </div>
    </AppProvider>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
