import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { APP_PATHS, buildEmbeddedAppUrl } from "../lib/navigation";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const u = new URL(request.url);
  const next = buildEmbeddedAppUrl(request.url, APP_PATHS.aiSeoWorkspace);
  next.hash = u.hash;
  throw redirect(next.toString());
};

export default function LegacyAiVisibilityRedirect() {
  return null;
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
