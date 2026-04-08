import { describe, it, expect, vi, beforeEach } from "vitest";

const { authenticateAdmin } = vi.hoisted(() => ({
  authenticateAdmin: vi.fn(),
}));

vi.mock("../../shopify.server", () => ({
  authenticate: {
    admin: authenticateAdmin,
  },
}));

vi.mock("../../lib/env.server", () => ({
  requireEnv: (name: string) => {
    if (name === "SHOPIFY_APP_URL") return "https://example.com";
    if (name === "SHOPIFY_API_KEY") return "test-shopify-api-key";
    return "test-value";
  },
}));

import { loader as sessionTokenLoader } from "../auth.session-token";
import { loader as bounceLoader } from "../session-token-bounce";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("auth.session-token loader", () => {
  it("redirects document requests to the bounce page when session is invalid", async () => {
    authenticateAdmin.mockResolvedValueOnce(new Response("Gone", { status: 410 }));

    const req = new Request(
      "https://example.com/auth/session-token?embedded=1&host=abc&id_token=stale&shopify-reload=https%3A%2F%2Fexample.com%2Fapp%3Fembedded%3D1%26host%3Dabc",
    );

    try {
      await sessionTokenLoader({ request: req } as any);
      expect.fail("expected redirect");
    } catch (resp) {
      expect(resp).toBeInstanceOf(Response);
      const r = resp as Response;
      expect(r.status).toBe(302);
      const location = r.headers.get("Location") || "";
      const url = new URL(location);
      expect(url.pathname).toBe("/session-token-bounce");
      expect(url.searchParams.get("embedded")).toBe("1");
      expect(url.searchParams.get("host")).toBe("abc");
      expect(url.searchParams.get("id_token")).toBeNull();
      expect(url.searchParams.get("shopify-reload")).toContain("/auth/session-token");
      expect(url.searchParams.get("shopify-reload")).toContain("embedded=1");
    }
  });

  it("returns a retryable 401 for XHR requests with invalid session", async () => {
    authenticateAdmin.mockResolvedValueOnce(new Response("Gone", { status: 410 }));

    const req = new Request("https://example.com/auth/session-token?embedded=1", {
      headers: { Authorization: "Bearer stale-token" },
    });

    const resp = await sessionTokenLoader({ request: req } as any);
    expect(resp).toBeInstanceOf(Response);
    const r = resp as Response;
    expect(r.status).toBe(401);
    expect(r.headers.get("X-Shopify-Retry-Invalid-Session-Request")).toBe("1");
  });

  it("redirects valid session requests to the sanitized reload target", async () => {
    authenticateAdmin.mockResolvedValueOnce({
      admin: { graphql: vi.fn() },
      session: { shop: "example.myshopify.com" },
    });

    const req = new Request(
      "https://example.com/auth/session-token?embedded=1&shopify-reload=https%3A%2F%2Fexample.com%2Fapp%3Fembedded%3D1%26host%3Dabc%26id_token%3Dstale",
    );

    const resp = await sessionTokenLoader({ request: req } as any);
    expect(resp).toBeInstanceOf(Response);
    const r = resp as Response;
    expect(r.status).toBe(302);
    const url = new URL(r.headers.get("Location") || "https://example.com");
    expect(url.origin).toBe("https://example.com");
    expect(url.pathname).toBe("/app");
    expect(url.searchParams.get("id_token")).toBeNull();
    expect(url.searchParams.get("embedded")).toBe("1");
  });
});

describe("session-token-bounce loader", () => {
  it("renders the bounce shell", async () => {
    const req = new Request("https://example.com/session-token-bounce?shopify-reload=https%3A%2F%2Fexample.com%2Fapp%3Fembedded%3D1");

    const resp = await bounceLoader({ request: req } as any);
    expect(resp).toBeInstanceOf(Response);
    const r = resp as Response;
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).toContain('meta name="shopify-api-key" content="test-shopify-api-key"');
    expect(text).toContain("app-bridge.js");
    expect(text).toContain("window.location.replace");
  });

  it("rejects invalid reload targets", async () => {
    const req = new Request("https://example.com/session-token-bounce?shopify-reload=https%3A%2F%2Fevil.example.com%2Fapp");

    const resp = await bounceLoader({ request: req } as any);
    expect(resp).toBeInstanceOf(Response);
    const r = resp as Response;
    expect(r.status).toBe(400);
  });
});
