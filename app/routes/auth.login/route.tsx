import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs, HeadersFunction } from "react-router";
import { Form, useActionData, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { login } from "../../shopify.server";
import { loginErrorMessage } from "./error.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const result = await login(request);
  if (result instanceof Response) throw result;
  const errors = loginErrorMessage(result);
  const url = new URL(request.url);
  const language = url.searchParams.get("lang") === "en" ? "English" : "中文";
  return { errors, language };
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
  const { errors, language } = actionData || loaderData;

  return (
    <AppProvider embedded>
      <s-page>
        <Form method="post">
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
        </Form>
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
