import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

/**
 * Shopify Embedded App session token exchange endpoint.
 *
 * Important:
 * - In some flows (e.g. billing confirm / iframe reload), Shopify SDK may return a Response
 *   from `authenticate.admin(request)` (HTML/redirect) instead of throwing.
 * - If we accidentally treat it as an object, we return `null` and render a blank page.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const result = await authenticate.admin(request);
  // If Shopify SDK returns a Response (e.g. HTML/redirect), return it as-is.
  if (result instanceof Response) return result;
  // Fallback: if for any reason it doesn't return a Response, return 204.
  return new Response(null, { status: 204 });
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

