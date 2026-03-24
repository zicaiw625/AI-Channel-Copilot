import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, redirect } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { additionalAction } from "../lib/additional.server";
import { APP_PATHS, buildEmbeddedAppUrl } from "../lib/navigation";

export const action = additionalAction;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (url.pathname === "/app/attribution" || url.pathname === "/app/attribution/") {
    throw redirect(buildEmbeddedAppUrl(request.url, APP_PATHS.attributionRules).toString());
  }
  return null;
};

export default function AttributionLayout() {
  return <Outlet />;
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
