import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { ADDITIONAL_SECTION_QUERY, buildEmbeddedAppUrl } from "../lib/navigation";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  throw redirect(
    buildEmbeddedAppUrl(request.url, "/app/additional/attribution", {
      [ADDITIONAL_SECTION_QUERY]: "diagnostics",
    }).toString(),
  );
};

export default function LegacyAdditionalDiagnosticsRedirect() {
  return null;
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
