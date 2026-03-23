import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, redirect } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { additionalAction } from "../lib/additional.server";
import { buildEmbeddedAppUrl } from "../lib/navigation";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.pathname === "/app/additional") {
    throw redirect(buildEmbeddedAppUrl(request.url, "/app/additional/attribution").toString());
  }

  return null;
};

export const action = additionalAction;

export default function AdditionalRouteLayout() {
  return <Outlet />;
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
