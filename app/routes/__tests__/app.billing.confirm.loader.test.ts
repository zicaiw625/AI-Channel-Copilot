import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => {
  vi.clearAllMocks();
});

vi.mock("../../db.server", () => ({
  default: {
    session: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("../../lib/security/rateLimit.server", () => ({
  enforceRateLimit: vi.fn(),
  RateLimitRules: { API_DEFAULT: {} },
  buildRateLimitKey: vi.fn(),
}));

vi.mock("../../lib/graphqlSdk.server", () => ({
  extractAdminClient: vi.fn(),
}));

vi.mock("../../lib/billing.server", () => ({
  syncSubscriptionFromShopify: vi.fn(),
}));

vi.mock("../../lib/env.server", () => ({
  requireEnv: (name: string) => {
    switch (name) {
      case "SHOPIFY_API_KEY":
        return "test-shopify-api-key";
      case "SHOPIFY_API_SECRET":
        return "test-shopify-api-secret";
      case "SHOPIFY_APP_URL":
        return "https://example.com";
      case "SCOPES":
        return "read_orders,write_products";
      default:
        throw new Error(`[test mock] unexpected requireEnv(${name})`);
    }
  },
  readCriticalEnv: () => ({
    SHOPIFY_API_KEY: "test-shopify-api-key",
    SHOPIFY_API_SECRET: "test-shopify-api-secret",
    SHOPIFY_APP_URL: "https://example.com",
    SCOPES: ["read_orders", "write_products"],
  }),
  getAppConfig: () => ({
    core: {
      SHOPIFY_API_KEY: "test-shopify-api-key",
      SHOPIFY_API_SECRET: "test-shopify-api-secret",
      SHOPIFY_APP_URL: "https://example.com",
      SCOPES: ["read_orders", "write_products"],
    },
    flags: {
      demoMode: false,
      enableBilling: true,
      enableLoginForm: true,
      enableBackfillSweep: true,
      enableRetentionSweep: true,
      billingForceTest: false,
      showDebugPanels: false,
    },
    billing: {
      amount: 29,
      currencyCode: "USD",
      trialDays: 14,
      interval: "EVERY_30_DAYS",
      planName: "AI Copilot Pro",
    },
    queue: {
      maxRetries: 5,
      baseDelayMs: 500,
      maxDelayMs: 30000,
      pendingCooldownMs: 250,
      pendingMaxCooldownMs: 2000,
      maxBatch: 50,
    },
    server: {
      appUrl: "https://example.com",
      port: 3000,
    },
  }),
}));

import { loader as appBillingConfirmLoader } from "../app.billing.confirm";

describe("app/billing/confirm loader cookie fallback", () => {
  it("merges aicc_billing_ctx into missing query params and 302 back", async () => {
    const ctx = "shop=test.myshopify.com&host=abc&embedded=1&locale=en";
    const ctxRaw = encodeURIComponent(ctx);
    const cookie = `aicc_billing_ctx=${ctxRaw}; other=1`;

    const req = new Request("https://example.com/app/billing/confirm", {
      method: "GET",
      headers: new Headers({ Cookie: cookie }),
    });

    try {
      await appBillingConfirmLoader({ request: req } as any);
      expect.fail("expected loader to throw Response(302)");
    } catch (e) {
      const resp = e as Response;
      expect(resp).toBeInstanceOf(Response);
      expect(resp.status).toBe(302);
      const location = resp.headers.get("Location") || "";
      const url = new URL(location);
      expect(url.pathname).toBe("/app/billing/confirm");
      expect(url.searchParams.get("shop")).toBe("test.myshopify.com");
      expect(url.searchParams.get("host")).toBe("abc");
      expect(url.searchParams.get("embedded")).toBe("1");
      expect(url.searchParams.get("locale")).toBe("en");
      const setCookie = resp.headers.get("Set-Cookie") || "";
      expect(setCookie).toContain("aicc_billing_ctx=");
      expect(setCookie).toContain("Max-Age=0");
    }
  });
});

