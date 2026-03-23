import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  authenticateWebhook: vi.fn(),
  setSubscriptionTrialState: vi.fn(),
  setSubscriptionActiveState: vi.fn(),
  setSubscriptionExpiredState: vi.fn(),
  getBillingState: vi.fn(),
  webhookJobCreate: vi.fn(),
  webhookJobFindFirst: vi.fn(),
  webhookJobUpdateMany: vi.fn(),
}));

vi.mock("../app/shopify.server", () => ({
  authenticate: {
    webhook: routeMocks.authenticateWebhook,
  },
}));

vi.mock("../app/lib/billing.server", () => ({
  setSubscriptionTrialState: routeMocks.setSubscriptionTrialState,
  setSubscriptionActiveState: routeMocks.setSubscriptionActiveState,
  setSubscriptionExpiredState: routeMocks.setSubscriptionExpiredState,
  getBillingState: routeMocks.getBillingState,
  toPlanId: (value?: string | null) =>
    value === "free" || value === "pro" || value === "growth" ? value : null,
}));

vi.mock("../app/lib/billing/plans", () => ({
  PRIMARY_BILLABLE_PLAN_ID: "pro",
  resolvePlanByShopifyName: vi.fn(() => ({ id: "pro", trialSupported: false })),
  getPlanConfig: vi.fn(() => ({ id: "pro", trialSupported: false })),
}));

vi.mock("../app/db.server", () => ({
  default: {
    webhookJob: {
      create: routeMocks.webhookJobCreate,
      findFirst: routeMocks.webhookJobFindFirst,
      updateMany: routeMocks.webhookJobUpdateMany,
    },
  },
}));

vi.mock("../app/lib/logger.server", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { action } from "../app/routes/webhooks.app.subscriptions_update";

describe("app/subscriptions_update webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeMocks.authenticateWebhook.mockResolvedValue({
      shop: "demo.myshopify.com",
      payload: {
        app_subscription: {
          admin_graphql_api_id: "gid://shopify/AppSubscription/1",
          name: "AI Copilot Pro",
          status: "ACTIVE",
          trial_end: null,
        },
      },
    });
    routeMocks.getBillingState.mockResolvedValue({
      billingPlan: "pro",
      billingState: "PRO_ACTIVE",
      lastTrialEndAt: null,
    });
    routeMocks.setSubscriptionActiveState.mockResolvedValue(undefined);
    routeMocks.setSubscriptionTrialState.mockResolvedValue(undefined);
    routeMocks.setSubscriptionExpiredState.mockResolvedValue(undefined);
    routeMocks.webhookJobUpdateMany.mockResolvedValue({ count: 1 });
  });

  it("reclaims stale processing records before applying subscription changes", async () => {
    routeMocks.webhookJobCreate.mockRejectedValue({ code: "P2002" });
    routeMocks.webhookJobFindFirst.mockResolvedValue({
      id: 7,
      status: "processing",
      createdAt: new Date(Date.now() - 10 * 60 * 1000),
      startedAt: new Date(Date.now() - 10 * 60 * 1000),
    });

    const response = await action({
      request: new Request("http://test/webhooks/app/subscriptions_update", { method: "POST" }),
    } as any);

    expect(response.status).toBe(200);
    expect(routeMocks.webhookJobUpdateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          id: 7,
          status: "processing",
          OR: expect.arrayContaining([
            expect.objectContaining({
              startedAt: expect.objectContaining({ lt: expect.any(Date) }),
            }),
            expect.objectContaining({
              startedAt: null,
              createdAt: expect.objectContaining({ lt: expect.any(Date) }),
            }),
          ]),
        }),
        data: expect.objectContaining({
          status: "processing",
          error: null,
          finishedAt: null,
        }),
      }),
    );
    expect(routeMocks.setSubscriptionActiveState).toHaveBeenCalledWith(
      "demo.myshopify.com",
      "pro",
      "ACTIVE",
    );
  });

  it("skips duplicate delivery when the existing processing record is still fresh", async () => {
    routeMocks.webhookJobCreate.mockRejectedValue({ code: "P2002" });
    routeMocks.webhookJobFindFirst.mockResolvedValue({
      id: 9,
      status: "processing",
      createdAt: new Date(),
      startedAt: new Date(),
    });

    const response = await action({
      request: new Request("http://test/webhooks/app/subscriptions_update", { method: "POST" }),
    } as any);

    expect(response.status).toBe(200);
    expect(routeMocks.setSubscriptionActiveState).not.toHaveBeenCalled();
    expect(routeMocks.setSubscriptionTrialState).not.toHaveBeenCalled();
    expect(routeMocks.setSubscriptionExpiredState).not.toHaveBeenCalled();
  });
});
