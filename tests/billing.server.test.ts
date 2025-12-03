import { describe, it, expect } from "vitest";
import { ensureBilling, hasActiveSubscription } from "../app/lib/billing.server";

type AdminGraphqlClient = {
  graphql: (
    query: string,
    options: { variables?: Record<string, unknown>; signal?: AbortSignal },
  ) => Promise<Response>;
};

const planName = "AI Channel Copilot Basic";

describe("billing.server", () => {
  it("hasActiveSubscription returns true when active subscription matches", async () => {
    const admin: AdminGraphqlClient = {
      graphql: async () =>
        new Response(
          JSON.stringify({
            data: {
              currentAppInstallation: {
                activeSubscriptions: [
                  { id: "gid://shopify/AppSubscription/1", name: planName, status: "ACTIVE" },
                ],
              },
            },
          }),
          { status: 200 },
        ),
    };
    const ok = await hasActiveSubscription(admin as any, planName);
    expect(ok).toBe(true);
  });

  it("hasActiveSubscription returns false when no active subscription", async () => {
    const admin: AdminGraphqlClient = {
      graphql: async () =>
        new Response(
          JSON.stringify({
            data: {
              currentAppInstallation: {
                activeSubscriptions: [
                  { id: "gid://shopify/AppSubscription/2", name: planName, status: "PENDING" },
                ],
              },
            },
          }),
          { status: 200 },
        ),
    };
    const ok = await hasActiveSubscription(admin as any, planName);
    expect(ok).toBe(false);
  });

  it("ensureBilling does nothing when already active", async () => {
    process.env.SHOPIFY_APP_URL = "https://app.example.com";
    const admin: AdminGraphqlClient = {
      graphql: async (query) => {
        if (query.includes("query ActiveSubscriptions")) {
          return new Response(
            JSON.stringify({
              data: {
                currentAppInstallation: {
                  activeSubscriptions: [
                    { id: "gid://shopify/AppSubscription/1", name: planName, status: "ACTIVE" },
                  ],
                },
              },
            }),
            { status: 200 },
          );
        }
        throw new Error("unexpected mutation call");
      },
    };
    await expect(
      ensureBilling(admin as any, "test-shop.myshopify.com", new Request("https://app.example.com/app")),
    ).resolves.toBeUndefined();
  });

  // Note: ensureBilling is now a no-op function in the new billing flow.
  // The billing check happens through getEffectivePlan and access control instead.
  // These tests reflect the current implementation where ensureBilling always returns void.
  
  it("ensureBilling returns void (legacy no-op)", async () => {
    process.env.SHOPIFY_APP_URL = "https://app.example.com";
    const admin: AdminGraphqlClient = {
      graphql: async () => {
        throw new Error("should not be called");
      },
    };
    // ensureBilling is now a no-op, always returns void
    await expect(
      ensureBilling(admin as any, "test-shop.myshopify.com", new Request("https://app.example.com/app")),
    ).resolves.toBeUndefined();
  });
});

