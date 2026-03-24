import { beforeEach, describe, expect, it, vi } from "vitest";

const stateMocks = vi.hoisted(() => ({
  getBillingState: vi.fn(),
}));

vi.mock("../app/lib/billing/state.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../app/lib/billing/state.server")>();
  return {
    ...actual,
    getBillingState: stateMocks.getBillingState,
  };
});

import { calculateRemainingTrialDays } from "../app/lib/billing/shopify.server";

describe("calculateRemainingTrialDays", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 0 when merchant is on paid ACTIVE (not trialing) for the queried plan", async () => {
    stateMocks.getBillingState.mockResolvedValue({
      shopDomain: "x.myshopify.com",
      isDevShop: false,
      billingPlan: "growth",
      billingState: "GROWTH_ACTIVE",
      firstInstalledAt: new Date(),
      lastTrialStartAt: null,
      lastTrialEndAt: null,
      usedTrialDays: 10,
      hasEverSubscribed: true,
    });

    const remaining = await calculateRemainingTrialDays("x.myshopify.com", "growth");
    expect(remaining).toBe(0);
  });

  it("does not use Pro trial budget when displaying Growth plan remaining (cross-plan)", async () => {
    stateMocks.getBillingState.mockResolvedValue({
      shopDomain: "x.myshopify.com",
      isDevShop: false,
      billingPlan: "growth",
      billingState: "GROWTH_ACTIVE",
      firstInstalledAt: new Date(),
      lastTrialStartAt: null,
      lastTrialEndAt: null,
      usedTrialDays: 10,
      hasEverSubscribed: true,
    });

    const wrongPlanRemaining = await calculateRemainingTrialDays("x.myshopify.com", "pro");
    expect(wrongPlanRemaining).toBe(0);
  });

  it("still returns days left when trialing with a future trial end", async () => {
    const end = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);
    stateMocks.getBillingState.mockResolvedValue({
      shopDomain: "x.myshopify.com",
      isDevShop: false,
      billingPlan: "growth",
      billingState: "GROWTH_TRIALING",
      firstInstalledAt: new Date(),
      lastTrialStartAt: new Date(),
      lastTrialEndAt: end,
      usedTrialDays: 0,
      hasEverSubscribed: true,
    });

    const remaining = await calculateRemainingTrialDays("x.myshopify.com", "growth");
    expect(remaining).toBeGreaterThanOrEqual(4);
    expect(remaining).toBeLessThanOrEqual(5);
  });
});
