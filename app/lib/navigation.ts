import { normalizeLanguageSearchParams } from "./language";

const SHOPIFY_CONTEXT_KEYS = ["host", "embedded", "locale"] as const;

type ParamValue = string | null | undefined;

function toSearchParams(search: string | URLSearchParams) {
  return new URLSearchParams(typeof search === "string" ? search : search.toString());
}

export function getShopifyContextParams(search: string | URLSearchParams) {
  const source = toSearchParams(search);
  const params = new URLSearchParams();

  for (const key of SHOPIFY_CONTEXT_KEYS) {
    const value = source.get(key);
    if (value) {
      params.set(key, value);
    }
  }

  return params;
}

export function getPreservedSearchParams(search: string | URLSearchParams) {
  return normalizeLanguageSearchParams(toSearchParams(search));
}

export function buildEmbeddedAppPath(
  path: string,
  search: string | URLSearchParams,
  extraParams?: Record<string, ParamValue>,
  hash?: string,
) {
  const params = getPreservedSearchParams(search);

  for (const [key, value] of Object.entries(extraParams ?? {})) {
    if (value == null || value === "") {
      params.delete(key);
    } else {
      params.set(key, value);
    }
  }

  const query = params.toString();
  const resolvedHash = hash ? (hash.startsWith("#") ? hash : `#${hash}`) : "";

  return `${path}${query ? `?${query}` : ""}${resolvedHash}`;
}

export function buildEmbeddedAppUrl(
  requestUrl: string | URL,
  path: string,
  extraParams?: Record<string, ParamValue>,
  hash?: string,
) {
  const url = typeof requestUrl === "string" ? new URL(requestUrl) : new URL(requestUrl.toString());
  return new URL(buildEmbeddedAppPath(path, url.search, extraParams, hash), url.origin);
}
