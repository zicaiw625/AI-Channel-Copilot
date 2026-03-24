import { describe, expect, it } from "vitest";
import {
  isTrialEndInFuture,
  resolveAppSubscriptionTrialEnd,
} from "../app/lib/billing/trialEnd.server";

const DAY = 24 * 60 * 60 * 1000;

describe("resolveAppSubscriptionTrialEnd", () => {
  it("prefers explicit trial_end from Shopify over derived", () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const explicit = new Date("2026-01-20T12:00:00.000Z");
    const got = resolveAppSubscriptionTrialEnd({
      trialEndFromShopify: explicit,
      createdAt,
      trialDays: 14,
    });
    expect(got?.getTime()).toBe(explicit.getTime());
  });

  it("derives from createdAt + trialDays when no explicit end", () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const got = resolveAppSubscriptionTrialEnd({
      createdAt,
      trialDays: 14,
    });
    expect(got?.getTime()).toBe(createdAt.getTime() + 14 * DAY);
  });

  it("returns null for invalid explicit date", () => {
    const got = resolveAppSubscriptionTrialEnd({
      trialEndFromShopify: new Date(""),
    });
    expect(got).toBeNull();
  });

  it("returns null when trialDays is 0", () => {
    const got = resolveAppSubscriptionTrialEnd({
      createdAt: new Date(),
      trialDays: 0,
    });
    expect(got).toBeNull();
  });
});

describe("isTrialEndInFuture", () => {
  it("returns true when end is after asOf", () => {
    expect(isTrialEndInFuture(new Date(Date.now() + DAY), Date.now())).toBe(true);
  });

  it("returns false for null", () => {
    expect(isTrialEndInFuture(null)).toBe(false);
  });
});
