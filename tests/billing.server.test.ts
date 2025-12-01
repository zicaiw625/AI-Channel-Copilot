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

  it("ensureBilling redirects to confirmationUrl when not active", async () => {
    process.env.SHOPIFY_APP_URL = "https://app.example.com";
    const confirmationUrl = "https://shopify.com/confirm/subscription";
    const admin: AdminGraphqlClient = {
      graphql: async (query) => {
        if (query.includes("query ActiveSubscriptions")) {
          return new Response(
            JSON.stringify({
              data: {
                currentAppInstallation: { activeSubscriptions: [] },
              },
            }),
            { status: 200 },
          );
        }
        if (query.includes("mutation AppSubscriptionCreate")) {
          return new Response(
            JSON.stringify({
              data: {
                appSubscriptionCreate: { confirmationUrl },
              },
            }),
            { status: 200 },
          );
        }
        throw new Error("unexpected query");
      },
    };

    try {
      await ensureBilling(admin as any, "test-shop.myshopify.com", new Request("https://app.example.com/app"));
      throw new Error("expected redirect");
    } catch (e) {
      const resp = e as Response;
      expect(resp.status).toBe(302);
      expect(resp.headers.get("Location")).toBe(confirmationUrl);
    }
  });

  it("ensureBilling continues without redirect when appSubscriptionCreate fails", async () => {
    process.env.SHOPIFY_APP_URL = "https://app.example.com";
    const admin: AdminGraphqlClient = {
      graphql: async (query) => {
        if (query.includes("query ActiveSubscriptions")) {
          return new Response(
            JSON.stringify({ data: { currentAppInstallation: { activeSubscriptions: [] } } }),
            { status: 200 },
          );
        }
        if (query.includes("mutation AppSubscriptionCreate")) {
          return new Response("bad request", { status: 400 });
        }
        throw new Error("unexpected query");
      },
    };
    await expect(
      ensureBilling(admin as any, "test-shop.myshopify.com", new Request("https://app.example.com/app")),
    ).resolves.toBeUndefined();
  });
});

