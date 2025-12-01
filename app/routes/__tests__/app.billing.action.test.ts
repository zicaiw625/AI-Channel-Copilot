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

describe("app.billing action login fallback", () => {
  it("preserves headers and uses absolute URL (en)", async () => {
    const form = new FormData();
    form.set("shop", "helvetibillteststore.myshopify.com");
    const headers = new Headers({ Cookie: "sid=xyz; other=1" });
    const req = new Request("https://example.com/app/billing?lang=en", { method: "POST", body: form, headers });

    try {
      await action({ request: req } as any);
    } catch (resp) {
      expect(resp).toBeInstanceOf(Response);
    }

    expect(captured).not.toBeNull();
    const url = new URL(captured!.url);
    expect(url.href).toBe("https://example.com/auth/login?lang=en");
    expect(captured!.method).toBe("POST");
    expect(captured!.headers.get("cookie")).toContain("sid=xyz");
  });

  it("defaults to zh when lang missing", async () => {
    captured = null;
    const form = new FormData();
    const headers = new Headers({ Cookie: "sid=abc" });
    const req = new Request("https://example.com/app/billing", { method: "POST", body: form, headers });

    try {
      await action({ request: req } as any);
    } catch (resp) {
      expect(resp).toBeInstanceOf(Response);
    }

    const url = new URL(captured!.url);
    expect(url.href).toBe("https://example.com/auth/login?lang=zh");
    expect(captured!.headers.get("cookie")).toContain("sid=abc");
  });
});
