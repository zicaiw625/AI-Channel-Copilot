import { describe, expect, it } from "vitest";

import {
  buildEmbeddedAppPath,
  buildEmbeddedAppUrl,
  buildAttributionHref,
  buildAdditionalBackHref,
  buildFunnelBackHref,
  buildFunnelHref,
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

  it("buildAttributionHref preserves ai visibility tab/fromTab context", () => {
    const href = buildAttributionHref(
      "?host=abc&embedded=1&locale=en&lang=English&tab=faq&fromTab=schema&foo=bar&backTo=optimization",
      { backTo: "dashboard" },
    );

    const url = new URL(`https://example.com${href}`);
    expect(url.pathname).toBe("/app/additional/attribution");
    expect(url.searchParams.get("tab")).toBe("faq");
    expect(url.searchParams.get("fromTab")).toBe("schema");
    expect(url.searchParams.get("backTo")).toBe("dashboard");
    expect(url.searchParams.get("foo")).toBe("bar");
  });

  it("buildAdditionalBackHref restores matching ai-visibility tab", () => {
    const href = buildAdditionalBackHref(
      "?host=abc&embedded=1&locale=en&lang=English&backTo=workspace&tab=schema&fromTab=faq&foo=bar",
    );

    const url = new URL(`https://example.com${href}`);
    expect(url.pathname).toBe("/app/ai-visibility");
    expect(url.searchParams.get("tab")).toBe("schema");
    // 返回 workspace 时清空 return-state 参数
    expect(url.searchParams.has("backTo")).toBe(false);
    expect(url.searchParams.has("fromTab")).toBe(false);
  });

  it("buildAdditionalBackHref falls back to fromTab when tab missing", () => {
    const href = buildAdditionalBackHref(
      "?host=abc&embedded=1&locale=en&lang=English&backTo=workspace&fromTab=schema&foo=bar",
    );

    const url = new URL(`https://example.com${href}`);
    expect(url.pathname).toBe("/app/ai-visibility");
    expect(url.searchParams.get("tab")).toBe("schema");
  });

  it("buildFunnelHref preserves optimization fromTab context", () => {
    const href = buildFunnelHref(
      "?host=abc&embedded=1&locale=en&lang=English&fromTab=schema&foo=bar",
      { backTo: "optimization", fromTab: "schema", optimizationBackTo: "dashboard" },
    );

    const url = new URL(`https://example.com${href}`);
    expect(url.pathname).toBe("/app/funnel");
    expect(url.searchParams.get("backTo")).toBe("optimization");
    expect(url.searchParams.get("fromTab")).toBe("schema");
    expect(url.searchParams.get("optimizationBackTo")).toBe("dashboard");
    expect(url.searchParams.has("tab")).toBe(false);
    expect(url.searchParams.get("foo")).toBe("bar");
  });

  it("buildFunnelBackHref restores matching optimization fromTab context", () => {
    const href = buildFunnelBackHref(
      "?host=abc&embedded=1&locale=en&lang=English&backTo=optimization&fromTab=faq&foo=bar",
    );

    const url = new URL(`https://example.com${href}`);
    expect(url.pathname).toBe("/app/optimization");
    expect(url.searchParams.has("backTo")).toBe(false);
    expect(url.searchParams.get("fromTab")).toBe("faq");
  });

  it("buildFunnelBackHref preserves optimization backTo target", () => {
    const href = buildFunnelBackHref(
      "?host=abc&embedded=1&locale=en&lang=English&backTo=optimization&fromTab=faq&optimizationBackTo=dashboard&foo=bar",
    );

    const url = new URL(`https://example.com${href}`);
    expect(url.pathname).toBe("/app/optimization");
    expect(url.searchParams.get("backTo")).toBe("dashboard");
    expect(url.searchParams.get("fromTab")).toBe("faq");
  });
});
