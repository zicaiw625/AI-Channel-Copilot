import { describe, it, expect, vi } from "vitest";

let captured: Request | null = null;

vi.mock("../../shopify.server", () => {
  return {
    authenticate: {
      admin: async () => {
        throw new Error("Missing access token");
      },
    },
    login: async (req: Request) => {
      captured = req;
      return new Response(null, { status: 202, headers: { Location: "https://admin.shopify.com/store/test/oauth/install?client_id=abc" } });
    },
  };
});

// Import after mocks so the module gets mocked dependencies
import { action } from "../app.billing";

describe("app.billing action auth fallback", () => {
  it("redirects to /auth with shop (preserves host/embedded/locale if present)", async () => {
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
    captured = null;
    const form = new FormData();
    const headers = new Headers({ Cookie: "sid=abc" });
    const req = new Request("https://example.com/app/billing", { method: "POST", body: form, headers });

    const resp = await action({ request: req } as any);
    expect(resp).toBeInstanceOf(Response);
    const r = resp as Response;
    expect(r.status).toBe(400);
  });
});
