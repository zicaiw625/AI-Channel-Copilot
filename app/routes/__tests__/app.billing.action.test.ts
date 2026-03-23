import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  authenticateAdmin,
  listPaidSubscriptions,
  cancelSubscription,
  requestSubscription,
  computeIsTestMode,
  calculateRemainingTrialDays,
  detectAndPersistDevShop,
  getBillingState,
  activateFreePlan,
} = vi.hoisted(() => ({
  authenticateAdmin: vi.fn(),
  listPaidSubscriptions: vi.fn(),
  cancelSubscription: vi.fn(),
  requestSubscription: vi.fn(),
  computeIsTestMode: vi.fn(),
  calculateRemainingTrialDays: vi.fn(),
  detectAndPersistDevShop: vi.fn(),
  getBillingState: vi.fn(),
  activateFreePlan: vi.fn(),
}));

vi.mock("../../shopify.server", () => ({
  authenticate: {
    admin: authenticateAdmin,
  },
}));

vi.mock("../../lib/env.server", () => ({
  readAppFlags: () => ({
    demoMode: false,
    enableBilling: true,
    enableLoginForm: false,
    enableBackfillSweep: true,
    enableRetentionSweep: true,
    billingForceTest: false,
    showDebugPanels: false,
  }),
}));

vi.mock("../../lib/billing.server", () => ({
  listPaidSubscriptions,
  cancelSubscription,
  requestSubscription,
  computeIsTestMode,
  calculateRemainingTrialDays,
  detectAndPersistDevShop,
  getBillingState,
  activateFreePlan,
}));

// Import after mocks so the module gets mocked dependencies
import { action } from "../app.billing";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("app.billing action auth fallback", () => {
  it("redirects to /auth with shop (preserves host/embedded/locale if present)", async () => {
    authenticateAdmin.mockRejectedValueOnce(new Error("Missing access token"));

    const form = new FormData();
    form.set("shop", "helvetibillteststore.myshopify.com");
    const headers = new Headers({ Cookie: "sid=xyz; other=1" });
    const req = new Request("https://example.com/app/billing?embedded=1&host=abc&locale=en", { method: "POST", body: form, headers });

    try {
      await action({ request: req } as any);
    } catch (resp) {
      expect(resp).toBeInstanceOf(Response);
      const r = resp as Response;
      expect(r.status).toBe(302);
      const loc = r.headers.get("Location") || "";
      const url = new URL(loc);
      expect(url.origin).toBe("https://example.com");
      expect(url.pathname).toBe("/auth");
      expect(url.searchParams.get("shop")).toBe("helvetibillteststore.myshopify.com");
      expect(url.searchParams.get("embedded")).toBe("1");
      expect(url.searchParams.get("host")).toBe("abc");
      expect(url.searchParams.get("locale")).toBe("en");
    }
  });

  it("returns 400 when shop missing", async () => {
    authenticateAdmin.mockRejectedValueOnce(new Error("Missing access token"));

    const form = new FormData();
    const headers = new Headers({ Cookie: "sid=abc" });
    const req = new Request("https://example.com/app/billing", { method: "POST", body: form, headers });

    const resp = await action({ request: req } as any);
    expect(resp).toBeInstanceOf(Response);
    const r = resp as Response;
    expect(r.status).toBe(400);
  });
});

describe("app.billing action subscription logic", () => {
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
    getBillingState.mockResolvedValueOnce({ billingState: "FREE_ACTIVE", billingPlan: "free" });
    calculateRemainingTrialDays.mockResolvedValueOnce(7);
    requestSubscription.mockResolvedValueOnce("https://confirm.example.com/charge");

    const form = new FormData();
    form.set("intent", "upgrade");
    form.set("planId", "growth");
    const req = new Request("https://example.com/app/billing?embedded=1&host=abc&locale=en", { method: "POST", body: form });

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
      7,
      expect.any(Object),
    );
  });

  it("downgrade cancels all paid subscriptions and activates free plan", async () => {
    authenticateAdmin.mockResolvedValueOnce({
      admin: { graphql: vi.fn() },
      session: { shop: "test.myshopify.com" },
    });

    listPaidSubscriptions.mockResolvedValueOnce([
      { id: "sub_pro", planId: "pro", status: "ACTIVE", createdAt: new Date("2025-01-01T00:00:00Z") },
      { id: "sub_growth", planId: "growth", status: "ACTIVE", createdAt: new Date("2025-02-01T00:00:00Z") },
    ]);
    cancelSubscription.mockResolvedValue("CANCELLED");
    activateFreePlan.mockResolvedValueOnce(undefined);

    const form = new FormData();
    form.set("intent", "downgrade");
    const req = new Request("https://example.com/app/billing", { method: "POST", body: form });

    const resp = await action({ request: req } as any);
    expect(resp).toBeInstanceOf(Response);
    const data = await (resp as Response).json();
    expect(data.ok).toBe(true);

    expect(cancelSubscription).toHaveBeenCalledTimes(2);
    expect(activateFreePlan).toHaveBeenCalledWith("test.myshopify.com");
  });

  it("redirects free selection to llms workspace and preserves context", async () => {
    authenticateAdmin.mockResolvedValueOnce({
      admin: { graphql: vi.fn() },
      session: { shop: "test.myshopify.com" },
    });

    const form = new FormData();
    form.set("intent", "select_free");
    const req = new Request("https://example.com/app/billing?embedded=1&host=abc&locale=en", { method: "POST", body: form });

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

  it("redirects free upgrade intent to llms workspace and preserves context", async () => {
    authenticateAdmin.mockResolvedValueOnce({
      admin: { graphql: vi.fn() },
      session: { shop: "test.myshopify.com" },
    });

    const form = new FormData();
    form.set("intent", "upgrade");
    form.set("planId", "free");
    const req = new Request("https://example.com/app/billing?embedded=1&host=abc&locale=en", { method: "POST", body: form });

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
    expect(requestSubscription).not.toHaveBeenCalled();
  });
});
