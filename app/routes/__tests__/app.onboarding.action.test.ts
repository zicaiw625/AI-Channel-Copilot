import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  authenticateAdmin,
  listPaidSubscriptions,
  cancelSubscription,
  requestSubscription,
  computeIsTestMode,
  calculateRemainingTrialDays,
  detectAndPersistDevShop,
  activateFreePlan,
  getBillingState,
} = vi.hoisted(() => ({
  authenticateAdmin: vi.fn(),
  listPaidSubscriptions: vi.fn(),
  cancelSubscription: vi.fn(),
  requestSubscription: vi.fn(),
  computeIsTestMode: vi.fn(),
  calculateRemainingTrialDays: vi.fn(),
  detectAndPersistDevShop: vi.fn(),
  activateFreePlan: vi.fn(),
  getBillingState: vi.fn(),
}));

vi.mock("../../shopify.server", () => ({
  authenticate: {
    admin: authenticateAdmin,
  },
}));

vi.mock("../../lib/billing.server", () => ({
  listPaidSubscriptions,
  cancelSubscription,
  requestSubscription,
  computeIsTestMode,
  calculateRemainingTrialDays,
  detectAndPersistDevShop,
  activateFreePlan,
  getBillingState,
}));

// Import after mocks so the module gets mocked dependencies
import { action } from "../app.onboarding";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("app.onboarding action subscription logic", () => {
  it("cancels existing paid subscriptions before creating a new one", async () => {
    authenticateAdmin.mockResolvedValueOnce({
      admin: { graphql: vi.fn() },
      session: { shop: "test.myshopify.com" },
    });

    listPaidSubscriptions.mockResolvedValueOnce([
      { id: "sub_old", planId: "pro", status: "ACTIVE", createdAt: new Date("2025-01-01T00:00:00Z") },
    ]);
    cancelSubscription.mockResolvedValueOnce("CANCELLED");
    detectAndPersistDevShop.mockResolvedValueOnce(false);
    computeIsTestMode.mockResolvedValueOnce(false);
    calculateRemainingTrialDays.mockResolvedValueOnce(14);
    requestSubscription.mockResolvedValueOnce("https://confirm.example.com/charge");

    const form = new FormData();
    form.set("intent", "select_plan");
    form.set("planId", "growth");
    const req = new Request("https://example.com/app/onboarding?embedded=1&host=abc&locale=en", { method: "POST", body: form });

    try {
      await action({ request: req } as any);
      expect.fail("expected redirect response");
    } catch (resp) {
      const r = resp as Response;
      expect(r.status).toBe(302);
      const loc = r.headers.get("Location") || "";
      const url = new URL(loc);
      expect(url.pathname).toBe("/app/redirect");
      expect(url.searchParams.get("to")).toBe("https://confirm.example.com/charge");
    }

    expect(cancelSubscription).toHaveBeenCalledWith(expect.anything(), "sub_old", true);
    expect(requestSubscription).toHaveBeenCalledWith(
      expect.anything(),
      "test.myshopify.com",
      "growth",
      false,
      14,
      expect.any(Object),
    );
  });

  it("redirects free plan selection to llms workspace and preserves context", async () => {
    authenticateAdmin.mockResolvedValueOnce({
      admin: { graphql: vi.fn() },
      session: { shop: "test.myshopify.com" },
    });

    const form = new FormData();
    form.set("intent", "select_plan");
    form.set("planId", "free");
    const req = new Request("https://example.com/app/onboarding?embedded=1&host=abc&locale=en", { method: "POST", body: form });

    try {
      await action({ request: req } as any);
      expect.fail("expected redirect response");
    } catch (resp) {
      const r = resp as Response;
      expect(r.status).toBe(302);
      const loc = r.headers.get("Location") || "";
      const url = new URL(loc);
      expect(url.pathname).toBe("/app/ai-visibility");
      expect(url.searchParams.get("tab")).toBe("llms");
      expect(url.searchParams.get("embedded")).toBe("1");
      expect(url.searchParams.get("host")).toBe("abc");
      expect(url.searchParams.get("locale")).toBe("en");
    }

    expect(activateFreePlan).toHaveBeenCalledWith("test.myshopify.com");
  });
});
