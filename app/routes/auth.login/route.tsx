import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs, HeadersFunction } from "react-router";
import { useActionData, useLoaderData, useRouteError } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { login } from "../../shopify.server";
import { loginErrorMessage } from "./error.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const result = await login(request);
  if (result instanceof Response) throw result;
  const errors = loginErrorMessage(result);
  const url = new URL(request.url);
  const language = url.searchParams.get("lang") === "en" ? "English" : "中文";
  return { errors, language, apiKey: process.env.SHOPIFY_API_KEY };
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
  };
};

export default function Auth() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [shop, setShop] = useState("");
  const { errors, language, apiKey } = actionData || loaderData;
  const app = useAppBridge();

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const lang = language === "English" ? "en" : "zh";
    const resp = await fetch(`/auth/login.data?lang=${lang}`, { method: "POST", body: formData });
    if (resp.status === 202) {
      let target = resp.headers.get("Location") || "";
      try {
        const data = await resp.clone().json().catch(() => null);
        if (!target && data && typeof data.url === "string") target = data.url;
      } catch {}
      if (!target && apiKey && shop) {
        const store = shop.replace(/\.myshopify\.com$/i, "");
        target = `https://admin.shopify.com/store/${store}/oauth/install?client_id=${apiKey}`;
      }
      if (target) {
        try { (window.top || window).location.href = target; } catch { window.location.href = target; }
        return;
      }
    }
  };

  return (
    <AppProvider embedded>
      <s-page>
        <form method="post" onSubmit={submit}>
        <s-section heading={language === "English" ? "Log in" : "登录"}>
          <s-text-field
            name="shop"
            label={language === "English" ? "Shop domain" : "店铺域名"}
            details={language === "English" ? "example.myshopify.com" : "example.myshopify.com"}
            value={shop}
            onChange={(e) => setShop(e.currentTarget.value)}
            autocomplete="on"
            error={errors.shop}
          ></s-text-field>
          <s-button type="submit">{language === "English" ? "Log in" : "登录"}</s-button>
        </s-section>
        </form>
      </s-page>
    </AppProvider>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
