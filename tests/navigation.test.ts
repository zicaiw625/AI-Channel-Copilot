import { describe, expect, it } from "vitest";

import {
  APP_PATHS,
  buildAttributionHref,
  buildEmbeddedAppPath,
  buildEmbeddedAppUrl,
  buildFunnelHref,
  buildOptimizationHref,
  buildUTMWizardHref,
  getPreservedSearchParams,
  getShopifyContextParams,
  toAppRoute,
} from "../app/lib/navigation";

describe("navigation helpers", () => {
  it("preserves arbitrary query params when building embedded paths", () => {
    const path = buildEmbeddedAppPath(
      "/app/ai-seo/workspace",
      "?host=abc&embedded=1&locale=en&lang=English&foo=bar",
      { tab: "llms" },
    );

    const url = new URL(`https://example.com${path}`);

    expect(url.pathname).toBe("/app/ai-seo/workspace");
    expect(url.searchParams.get("host")).toBe("abc");
    expect(url.searchParams.get("embedded")).toBe("1");
    expect(url.searchParams.get("locale")).toBe("en");
    expect(url.searchParams.get("lang")).toBe("en");
    expect(url.searchParams.get("foo")).toBe("bar");
    expect(url.searchParams.get("tab")).toBe("llms");
  });

  it("allows explicit params to override or remove existing values", () => {
    const path = buildEmbeddedAppPath(
      "/app/ai-seo/optimization",
      "?host=abc&embedded=1&locale=en&tab=faq&foo=bar",
      { tab: null, foo: null },
      "product-schema-settings",
    );

    const url = new URL(`https://example.com${path}`);

    expect(url.pathname).toBe("/app/ai-seo/optimization");
    expect(url.searchParams.has("tab")).toBe(false);
    expect(url.searchParams.has("foo")).toBe(false);
    expect(url.hash).toBe("#product-schema-settings");
  });

  it("removes legacy navigation params when clearing via dashboard href", () => {
    const path = buildEmbeddedAppPath("/app", "?host=abc&lang=en&backTo=dashboard&fromTab=schema&optimizationBackTo=workspace", {
      backTo: null,
      fromTab: null,
      tab: null,
      utmTab: null,
      optimizationBackTo: null,
    });

    const url = new URL(`https://example.com${path}`);
    expect(url.pathname).toBe("/app");
    expect(url.searchParams.has("backTo")).toBe(false);
    expect(url.searchParams.has("fromTab")).toBe(false);
    expect(url.searchParams.has("optimizationBackTo")).toBe(false);
  });

  it("preserves arbitrary query params when building embedded urls", () => {
    const url = buildEmbeddedAppUrl(
      "https://example.com/app/billing?host=abc&embedded=1&locale=en&lang=English",
      "/app/ai-seo/workspace",
      { tab: "llms" },
    );

    expect(url.pathname).toBe("/app/ai-seo/workspace");
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

  it("buildAttributionHref clears utm and workspace tab and uses rules path", () => {
    const href = buildAttributionHref("?host=abc&locale=en&lang=English&tab=faq&utmTab=bulk&foo=bar");

    const url = new URL(`https://example.com${href}`);
    expect(url.pathname).toBe(APP_PATHS.attributionRules);
    expect(url.searchParams.has("utmTab")).toBe(false);
    expect(url.searchParams.has("tab")).toBe(false);
    expect(url.searchParams.get("foo")).toBe("bar");
  });

  it("buildOptimizationHref and buildFunnelHref strip workspace tab", () => {
    const opt = new URL(`https://example.com${buildOptimizationHref("?host=abc&tab=faq&foo=bar")}`);
    expect(opt.pathname).toBe(APP_PATHS.aiSeoOptimization);
    expect(opt.searchParams.has("tab")).toBe(false);

    const funnel = new URL(`https://example.com${buildFunnelHref("?host=abc&tab=llms")}`);
    expect(funnel.pathname).toBe(APP_PATHS.aiSeoFunnel);
    expect(funnel.searchParams.has("tab")).toBe(false);
  });

  it("buildUTMWizardHref sets utmTab and clears workspace tab", () => {
    const href = buildUTMWizardHref("?host=abc&embedded=1&locale=en&lang=English&tab=llms&foo=bar", {
      utmTab: "bulk",
    });

    const url = new URL(`https://example.com${href}`);
    expect(url.pathname).toBe(APP_PATHS.attributionUtmWizard);
    expect(url.searchParams.get("utmTab")).toBe("bulk");
    expect(url.searchParams.has("tab")).toBe(false);
    expect(url.searchParams.get("foo")).toBe("bar");
  });

  it("toAppRoute matches buildEmbeddedAppPath for same inputs", () => {
    const search = "?host=x&lang=en";
    expect(toAppRoute(APP_PATHS.aiSeoWorkspace, search, { tab: "schema" })).toBe(
      buildEmbeddedAppPath(APP_PATHS.aiSeoWorkspace, search, { tab: "schema" }),
    );
  });
});
