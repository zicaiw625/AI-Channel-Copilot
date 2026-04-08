import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  authenticateAdmin,
  getSettings,
  shouldSkipBillingForPath,
  resolveUILanguageFromRequest,
} = vi.hoisted(() => ({
  authenticateAdmin: vi.fn(),
  getSettings: vi.fn(),
  shouldSkipBillingForPath: vi.fn(),
  resolveUILanguageFromRequest: vi.fn(),
}));

vi.mock("../../shopify.server", () => ({
  authenticate: {
    admin: authenticateAdmin,
  },
  unauthenticated: {},
}));

vi.mock("../../lib/env.server", () => ({
  readAppFlags: () => ({
    demoMode: false,
    enableBilling: true,
    enableLoginForm: false,
  }),
  requireEnv: (name: string) => {
    if (name === "SHOPIFY_APP_URL") return "https://example.com";
    return "test-shopify-api-key";
  },
}));

vi.mock("../../lib/settings.server", () => ({
  getSettings,
  syncShopPreferences: vi.fn(),
}));

vi.mock("../../lib/billing.server", () => ({
  shouldSkipBillingForPath: shouldSkipBillingForPath,
  detectAndPersistDevShop: vi.fn(),
  calculateRemainingTrialDays: vi.fn(),
  startBackfill: vi.fn(),
  processBackfillQueue: vi.fn(),
  // Re-exported billing.server members referenced by the module
  getBillingState: vi.fn(),
  hasActiveSubscription: vi.fn(),
}));

vi.mock("../../lib/access.server", () => ({
  FEATURES: {},
  getEffectivePlan: vi.fn(),
  hasFeature: vi.fn(),
}));

vi.mock("../../lib/language.server", () => ({
  resolveUILanguageFromRequest: resolveUILanguageFromRequest,
}));

import { loader as appLoader } from "../app";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("app.tsx loader protection", () => {
  it("allows /app/billing/confirm to proceed without embedded session (no OAuth throw)", async () => {
    authenticateAdmin.mockRejectedValueOnce(new Error("Missing access token"));
    shouldSkipBillingForPath.mockReturnValueOnce(true);
    getSettings.mockResolvedValueOnce({
      languages: ["中文"],
      timezones: ["UTC"],
      primaryCurrency: "USD",
      exposurePreferences: {},
    });
    resolveUILanguageFromRequest.mockReturnValueOnce("中文");

    const req = new Request("https://example.com/app/billing/confirm?embedded=1&host=abc&locale=en");

    const result = await appLoader({ request: req } as any);
    expect(result).toEqual(
      expect.objectContaining({
        apiKey: "test-shopify-api-key",
        plan: "none",
      }),
    );
  });

  it("redirects /app to the session-token bounce page when auth fails", async () => {
    authenticateAdmin.mockResolvedValueOnce(new Response("Gone", { status: 410 }));
    shouldSkipBillingForPath.mockReturnValueOnce(false);

    const req = new Request("https://example.com/app?embedded=1&host=abc&locale=en");

    try {
      await appLoader({ request: req } as any);
      expect.fail("expected redirect response");
    } catch (resp) {
      const r = resp as Response;
      expect(r.status).toBe(302);
      const location = r.headers.get("Location") || "";
      const url = new URL(location);
      expect(url.pathname).toBe("/session-token-bounce");
      expect(url.searchParams.get("shopify-reload")).toContain("/app?embedded=1&host=abc&locale=en");
    }

    expect(getSettings).not.toHaveBeenCalled();
  });
});

