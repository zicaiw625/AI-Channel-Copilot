import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  buildSessionTokenBounceUrl,
  invalidSessionRetryResponse,
  isBrowserAuthRequest,
  sanitizeReloadTarget,
} from "../lib/sessionToken.server";

/**
 * Shopify Embedded App session token exchange endpoint.
 *
 * Mainstream Shopify apps treat invalid embedded sessions differently for document
 * requests and XHR requests:
 * - document request -> bounce page
 * - XHR -> 401 + retry header
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const reload = sanitizeReloadTarget(url.searchParams.get("shopify-reload"));

  let result: Awaited<ReturnType<typeof authenticate.admin>> | Response;
  try {
    result = await authenticate.admin(request);
  } catch (error) {
    if (error instanceof Response) {
      result = error;
    } else {
      throw error;
    }
  }

  if (result instanceof Response) {
    if (isBrowserAuthRequest(request)) {
      return invalidSessionRetryResponse();
    }

    throw redirect(buildSessionTokenBounceUrl(request.url));
  }

  if (reload) {
    return redirect(reload);
  }

  const cleanSearch = new URLSearchParams(url.search);
  cleanSearch.delete("id_token");
  cleanSearch.delete("shopify-reload");
  return redirect(`/app${cleanSearch.toString() ? `?${cleanSearch.toString()}` : ""}`);
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

