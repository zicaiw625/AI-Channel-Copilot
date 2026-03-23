import { describe, expect, it } from "vitest";

import {
  buildEmbeddedAppPath,
  buildEmbeddedAppUrl,
  getPreservedSearchParams,
  getShopifyContextParams,
} from "../app/lib/navigation";

describe("navigation helpers", () => {
  it("preserves arbitrary query params when building embedded paths", () => {
    const path = buildEmbeddedAppPath(
      "/app/ai-visibility",
      "?host=abc&embedded=1&locale=en&lang=English&foo=bar",
      { tab: "llms" },
    );

    const url = new URL(`https://example.com${path}`);

    expect(url.pathname).toBe("/app/ai-visibility");
    expect(url.searchParams.get("host")).toBe("abc");
    expect(url.searchParams.get("embedded")).toBe("1");
    expect(url.searchParams.get("locale")).toBe("en");
    expect(url.searchParams.get("lang")).toBe("en");
    expect(url.searchParams.get("foo")).toBe("bar");
    expect(url.searchParams.get("tab")).toBe("llms");
  });

  it("allows explicit params to override or remove existing values", () => {
    const path = buildEmbeddedAppPath(
      "/app/optimization",
      "?host=abc&embedded=1&locale=en&tab=faq&foo=bar",
      { tab: "schema", foo: null },
      "product-schema-settings",
    );

    const url = new URL(`https://example.com${path}`);

    expect(url.searchParams.get("tab")).toBe("schema");
    expect(url.searchParams.has("foo")).toBe(false);
    expect(url.hash).toBe("#product-schema-settings");
  });

  it("removes transient return-state params when explicitly cleared", () => {
    const path = buildEmbeddedAppPath(
      "/app/optimization",
      "?host=abc&embedded=1&locale=en&lang=English&backTo=dashboard&fromTab=schema&tab=faq",
      { backTo: null, fromTab: null, tab: null },
    );

    const url = new URL(`https://example.com${path}`);

    expect(url.searchParams.get("host")).toBe("abc");
    expect(url.searchParams.get("embedded")).toBe("1");
    expect(url.searchParams.get("locale")).toBe("en");
    expect(url.searchParams.get("lang")).toBe("en");
    expect(url.searchParams.has("backTo")).toBe(false);
    expect(url.searchParams.has("fromTab")).toBe(false);
    expect(url.searchParams.has("tab")).toBe(false);
  });

  it("preserves arbitrary query params when building embedded urls", () => {
    const url = buildEmbeddedAppUrl(
      "https://example.com/app/billing?host=abc&embedded=1&locale=en&lang=English",
      "/app/ai-visibility",
      { tab: "llms" },
    );

    expect(url.pathname).toBe("/app/ai-visibility");
    expect(url.searchParams.get("host")).toBe("abc");
    expect(url.searchParams.get("embedded")).toBe("1");
    expect(url.searchParams.get("locale")).toBe("en");
    expect(url.searchParams.get("lang")).toBe("en");
    expect(url.searchParams.get("tab")).toBe("llms");
  });

  it("still exposes only Shopify context keys when requested explicitly", () => {
    const params = getShopifyContextParams("?host=abc&embedded=1&locale=en&lang=English&foo=bar");

    expect(params.toString()).toBe("host=abc&embedded=1&locale=en");
  });

  it("clones all existing search params for in-page tab updates", () => {
    const params = getPreservedSearchParams("?host=abc&embedded=1&lang=English&foo=bar");
    params.set("tab", "faq");

    expect(params.toString()).toBe("host=abc&embedded=1&lang=en&foo=bar&tab=faq");
  });
});
