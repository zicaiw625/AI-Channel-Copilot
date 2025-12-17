/**
 * Billing State Management Tests
 * 测试计费状态管理的核心逻辑
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  isValidShopDomain,
  validateShopDomain,
  toPlanId,
  planStateKey,
  computeIncrementalTrialUsage,
  DAY_IN_MS,
  type BillingState,
} from "../app/lib/billing/state.server";
import {
  getPlanConfig,
  resolvePlanByShopifyName,
  validatePlanId,
  validateAndGetPlan,
  BILLING_PLANS,
  type PlanId,
} from "../app/lib/billing/plans";

// Mock prisma to avoid database calls in unit tests
vi.mock("../app/db.server", () => ({
  default: {
    shopBillingState: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
  },
}));

describe("Shop Domain Validation", () => {
  describe("isValidShopDomain", () => {
    it("accepts valid myshopify.com domains", () => {
      expect(isValidShopDomain("test-store.myshopify.com")).toBe(true);
      expect(isValidShopDomain("my-awesome-store.myshopify.com")).toBe(true);
      expect(isValidShopDomain("store123.myshopify.com")).toBe(true);
    });

    it("rejects invalid domains", () => {
      expect(isValidShopDomain("")).toBe(false);
      expect(isValidShopDomain(null)).toBe(false);
      expect(isValidShopDomain(undefined)).toBe(false);
      expect(isValidShopDomain("not-a-domain")).toBe(false);
      expect(isValidShopDomain("example.com")).toBe(false);
      expect(isValidShopDomain(".myshopify.com")).toBe(false);
      expect(isValidShopDomain("-invalid.myshopify.com")).toBe(false);
    });

    it("rejects domains that are too short or too long", () => {
      expect(isValidShopDomain("x")).toBe(false);
      expect(isValidShopDomain("a".repeat(256) + ".myshopify.com")).toBe(false);
    });
  });

  describe("validateShopDomain", () => {
    it("returns valid domain unchanged", () => {
      const domain = "test-store.myshopify.com";
      expect(validateShopDomain(domain, "test")).toBe(domain);
    });

    it("returns null for invalid domains", () => {
      expect(validateShopDomain("", "test")).toBe(null);
      expect(validateShopDomain("invalid", "test")).toBe(null);
    });
  });
});

describe("Plan ID Helpers", () => {
  describe("toPlanId", () => {
    it("returns valid plan IDs", () => {
      expect(toPlanId("free")).toBe("free");
      expect(toPlanId("pro")).toBe("pro");
      expect(toPlanId("growth")).toBe("growth");
    });

    it("returns null for invalid plan IDs", () => {
      expect(toPlanId("")).toBe(null);
      expect(toPlanId("invalid")).toBe(null);
      expect(toPlanId(null)).toBe(null);
      expect(toPlanId(undefined)).toBe(null);
    });
  });

  describe("planStateKey", () => {
    it("generates correct state keys", () => {
      expect(planStateKey("pro", "TRIALING")).toBe("PRO_TRIALING");
      expect(planStateKey("growth", "ACTIVE")).toBe("GROWTH_ACTIVE");
      expect(planStateKey("free", "EXPIRED")).toBe("FREE_EXPIRED");
    });
  });
});

describe("Trial Usage Calculation", () => {
  describe("computeIncrementalTrialUsage", () => {
    const mockPlan = getPlanConfig("pro");

    it("returns 0 when trial not started", () => {
      const state: BillingState = {
        shopDomain: "test.myshopify.com",
        isDevShop: false,
        billingPlan: "pro",
        billingState: "NO_PLAN",
        firstInstalledAt: null,
        usedTrialDays: 0,
        hasEverSubscribed: false,
      };

      expect(computeIncrementalTrialUsage(state, mockPlan, new Date())).toBe(0);
    });

    it("returns 0 when trial not supported", () => {
      const freePlan = getPlanConfig("free");
      const state: BillingState = {
        shopDomain: "test.myshopify.com",
        isDevShop: false,
        billingPlan: "free",
        billingState: "FREE_ACTIVE",
        firstInstalledAt: new Date(),
        lastTrialStartAt: new Date(),
        usedTrialDays: 0,
        hasEverSubscribed: false,
      };

      expect(computeIncrementalTrialUsage(state, freePlan, new Date())).toBe(0);
    });

    it("calculates correct usage for active trial", () => {
      const now = new Date();
      const trialStart = new Date(now.getTime() - 7 * DAY_IN_MS); // 7 days ago

      const state: BillingState = {
        shopDomain: "test.myshopify.com",
        isDevShop: false,
        billingPlan: "pro",
        billingState: "PRO_TRIALING",
        firstInstalledAt: trialStart,
        lastTrialStartAt: trialStart,
        usedTrialDays: 0,
        hasEverSubscribed: true,
      };

      const usage = computeIncrementalTrialUsage(state, mockPlan, now);
      expect(usage).toBe(7);
    });

    it("respects trial end date", () => {
      const now = new Date();
      const trialStart = new Date(now.getTime() - 20 * DAY_IN_MS); // 20 days ago
      const trialEnd = new Date(now.getTime() - 6 * DAY_IN_MS); // Ended 6 days ago

      const state: BillingState = {
        shopDomain: "test.myshopify.com",
        isDevShop: false,
        billingPlan: "pro",
        billingState: "PRO_TRIALING",
        firstInstalledAt: trialStart,
        lastTrialStartAt: trialStart,
        lastTrialEndAt: trialEnd,
        usedTrialDays: 0,
        hasEverSubscribed: true,
      };

      const usage = computeIncrementalTrialUsage(state, mockPlan, now);
      expect(usage).toBe(14); // Limited by trialEnd - trialStart
    });

    it("caps usage at plan's default trial days", () => {
      const now = new Date();
      const trialStart = new Date(now.getTime() - 30 * DAY_IN_MS); // 30 days ago

      const state: BillingState = {
        shopDomain: "test.myshopify.com",
        isDevShop: false,
        billingPlan: "pro",
        billingState: "PRO_TRIALING",
        firstInstalledAt: trialStart,
        lastTrialStartAt: trialStart,
        usedTrialDays: 0,
        hasEverSubscribed: true,
      };

      const usage = computeIncrementalTrialUsage(state, mockPlan, now);
      expect(usage).toBeLessThanOrEqual(mockPlan.defaultTrialDays);
    });
  });
});

describe("Plan Configuration", () => {
  describe("getPlanConfig", () => {
    it("returns correct config for each plan", () => {
      expect(getPlanConfig("free").priceUsd).toBe(0);
      expect(getPlanConfig("pro").priceUsd).toBe(29);
      expect(getPlanConfig("growth").priceUsd).toBe(79);
    });

    it("returns trial days for paid plans", () => {
      expect(getPlanConfig("free").trialSupported).toBe(false);
      expect(getPlanConfig("pro").trialSupported).toBe(true);
      expect(getPlanConfig("pro").defaultTrialDays).toBe(14);
      expect(getPlanConfig("growth").trialSupported).toBe(true);
    });
  });

  describe("resolvePlanByShopifyName", () => {
    it("resolves plan by Shopify name", () => {
      const proPlan = resolvePlanByShopifyName("AI Copilot Pro");
      expect(proPlan?.id).toBe("pro");

      const growthPlan = resolvePlanByShopifyName("AI Copilot Growth");
      expect(growthPlan?.id).toBe("growth");
    });

    it("handles case insensitivity", () => {
      const plan = resolvePlanByShopifyName("ai copilot pro");
      expect(plan?.id).toBe("pro");
    });

    it("returns null for unknown plan names", () => {
      expect(resolvePlanByShopifyName("Unknown Plan")).toBe(null);
      expect(resolvePlanByShopifyName("")).toBe(null);
      expect(resolvePlanByShopifyName(null)).toBe(null);
    });
  });

  describe("validatePlanId", () => {
    it("validates and returns correct plan IDs", () => {
      expect(validatePlanId("free")).toBe("free");
      expect(validatePlanId("pro")).toBe("pro");
      expect(validatePlanId("growth")).toBe("growth");
    });

    it("handles case insensitivity and trimming", () => {
      expect(validatePlanId("PRO")).toBe("pro");
      expect(validatePlanId(" pro ")).toBe("pro");
      expect(validatePlanId("Free")).toBe("free");
    });

    it("returns null for invalid inputs", () => {
      expect(validatePlanId("invalid")).toBe(null);
      expect(validatePlanId(123)).toBe(null);
      expect(validatePlanId(null)).toBe(null);
      expect(validatePlanId({})).toBe(null);
    });
  });

  describe("validateAndGetPlan", () => {
    it("returns plan config for valid plan ID", () => {
      const plan = validateAndGetPlan("pro");
      expect(plan).not.toBe(null);
      expect(plan?.id).toBe("pro");
      expect(plan?.priceUsd).toBe(29);
    });

    it("returns null for invalid plan ID", () => {
      expect(validateAndGetPlan("invalid")).toBe(null);
      expect(validateAndGetPlan(null)).toBe(null);
    });
  });
});

describe("Billing State Constants", () => {
  it("DAY_IN_MS is correct", () => {
    expect(DAY_IN_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe("Plan Features", () => {
  it("all plans have required fields", () => {
    const requiredFields = ["id", "name", "shopifyName", "priceUsd", "interval", "trialSupported", "includes", "status"];
    
    Object.values(BILLING_PLANS).forEach((plan) => {
      requiredFields.forEach((field) => {
        expect(plan).toHaveProperty(field);
      });
    });
  });

  it("paid plans have trial support", () => {
    const paidPlans = Object.values(BILLING_PLANS).filter(p => p.priceUsd > 0);
    paidPlans.forEach((plan) => {
      expect(plan.trialSupported).toBe(true);
      expect(plan.defaultTrialDays).toBeGreaterThan(0);
    });
  });

  it("free plan has no trial", () => {
    const freePlan = BILLING_PLANS.free;
    expect(freePlan.trialSupported).toBe(false);
    expect(freePlan.defaultTrialDays).toBe(0);
  });
});
