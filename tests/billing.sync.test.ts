import { beforeEach, describe, expect, it, vi } from "vitest";

const stateMocks = vi.hoisted(() => ({
  getBillingState: vi.fn(),
  upsertBillingState: vi.fn(),
  setSubscriptionTrialState: vi.fn(),
  setSubscriptionActiveState: vi.fn(),
  setSubscriptionExpiredState: vi.fn(),
}));

vi.mock("../app/lib/billing/state.server", () => ({
  DAY_IN_MS: 24 * 60 * 60 * 1000,
  getBillingState: stateMocks.getBillingState,
  upsertBillingState: stateMocks.upsertBillingState,
  setSubscriptionTrialState: stateMocks.setSubscriptionTrialState,
  setSubscriptionActiveState: stateMocks.setSubscriptionActiveState,
  setSubscriptionExpiredState: stateMocks.setSubscriptionExpiredState,
  toPlanId: (value?: string | null) =>
    value === "free" || value === "pro" || value === "growth" ? value : null,
}));

vi.mock("../app/lib/locks.server", () => ({
  withAdvisoryLock: async (_key: number, fn: () => Promise<unknown>) => ({
    result: await fn(),
    lockInfo: { acquired: true },
  }),
}));

import { detectAndPersistDevShop, syncSubscriptionFromShopify } from "../app/lib/billing.server";

type AdminGraphqlClient = {
  graphql: (
    query: string,
    options: { variables?: Record<string, unknown>; signal?: AbortSignal },
  ) => Promise<Response>;
};

const createAdmin = (activeSubscriptions: unknown[]): AdminGraphqlClient => ({
  graphql: async () =>
    new Response(
      JSON.stringify({
        data: {
          currentAppInstallation: {
            activeSubscriptions,
          },
        },
      }),
      { status: 200 },
    ),
});

describe("syncSubscriptionFromShopify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stateMocks.getBillingState.mockResolvedValue(null);
  });

  it("keeps pending subscriptions from being expired locally during sync", async () => {
    const admin = createAdmin([
      {
        id: "gid://shopify/AppSubscription/1",
        name: "AI Copilot Pro",
        status: "PENDING",
        trialDays: 14,
        createdAt: "2026-03-01T00:00:00Z",
        currentPeriodEnd: null,
      },
    ]);

    const result = await syncSubscriptionFromShopify(admin as any, "demo.myshopify.com");

    expect(result.status).toBe("PENDING");
    expect(stateMocks.setSubscriptionActiveState).toHaveBeenCalledWith("demo.myshopify.com", "pro", "PENDING");
    expect(stateMocks.setSubscriptionTrialState).not.toHaveBeenCalled();
    expect(stateMocks.setSubscriptionExpiredState).not.toHaveBeenCalled();
  });

  it("keeps later trial end from DB when GraphQL createdAt predates merchant approval", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-24T12:00:00.000Z"));
    const webhookTrialEnd = new Date("2026-04-07T00:00:00.000Z");
    stateMocks.getBillingState.mockResolvedValue({
      billingPlan: "pro",
      billingState: "PRO_TRIALING",
      lastTrialStartAt: new Date("2026-03-10T00:00:00.000Z"),
      usedTrialDays: 0,
      lastTrialEndAt: webhookTrialEnd,
    });

    const admin = createAdmin([
      {
        id: "gid://shopify/AppSubscription/3",
        name: "AI Copilot Pro",
        status: "ACTIVE",
        trialDays: 14,
        createdAt: "2026-03-14T00:00:00.000Z",
        currentPeriodEnd: null,
      },
    ]);

    const result = await syncSubscriptionFromShopify(admin as any, "demo.myshopify.com");

    expect(result.status).toBe("ACTIVE");
    expect(stateMocks.setSubscriptionTrialState).toHaveBeenCalledWith(
      "demo.myshopify.com",
      "pro",
      webhookTrialEnd,
      "ACTIVE",
      14,
    );
    expect(stateMocks.setSubscriptionActiveState).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("maps active subscriptions without an active Shopify trial to ACTIVE, not local trial", async () => {
    const admin = createAdmin([
      {
        id: "gid://shopify/AppSubscription/2",
        name: "AI Copilot Pro",
        status: "ACTIVE",
        trialDays: 0,
        createdAt: "2026-03-01T00:00:00Z",
        currentPeriodEnd: null,
      },
    ]);

    stateMocks.getBillingState.mockResolvedValue({
      billingPlan: "NO_PLAN",
      billingState: "NO_PLAN",
      lastTrialStartAt: null,
      usedTrialDays: 0,
    });

    const result = await syncSubscriptionFromShopify(admin as any, "demo.myshopify.com");

    expect(result.status).toBe("ACTIVE");
    expect(stateMocks.setSubscriptionActiveState).toHaveBeenCalledWith("demo.myshopify.com", "pro", "ACTIVE");
    expect(stateMocks.setSubscriptionTrialState).not.toHaveBeenCalled();
  });
});

describe("detectAndPersistDevShop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stateMocks.getBillingState.mockResolvedValue(null);
  });

  it("re-checks Shopify even when lastCheckedAt is recent", async () => {
    stateMocks.getBillingState.mockResolvedValue({
      isDevShop: true,
      billingPlan: "pro",
      billingState: "PRO_ACTIVE",
      lastCheckedAt: new Date(),
      lastUninstalledAt: null,
      lastReinstalledAt: null,
      firstInstalledAt: new Date("2026-01-01T00:00:00Z"),
    });

    const admin = {
      graphql: async () =>
        new Response(
          JSON.stringify({
            data: {
              shop: {
                plan: {
                  partnerDevelopment: false,
                  displayName: "Basic",
                },
              },
            },
          }),
          { status: 200 },
        ),
    };

    const result = await detectAndPersistDevShop(admin as any, "demo.myshopify.com");

    expect(result).toBe(false);
    expect(stateMocks.upsertBillingState).toHaveBeenCalledWith(
      "demo.myshopify.com",
      expect.objectContaining({ isDevShop: false }),
    );
  });
});
