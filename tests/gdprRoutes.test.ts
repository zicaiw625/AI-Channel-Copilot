import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../app/shopify.server", () => ({
  authenticate: {
    webhook: vi.fn(),
  },
}));

vi.mock("../app/lib/gdpr.server", () => ({
  extractGdprIdentifiers: vi.fn(() => ({
    customerIds: ["gid://shopify/Customer/1"],
    orderIds: ["gid://shopify/Order/10"],
    customerEmail: "demo@example.com",
  })),
  describeCustomerFootprint: vi.fn(),
  collectCustomerData: vi.fn(),
  redactCustomerRecords: vi.fn(),
  wipeShopData: vi.fn(),
}));

import { authenticate } from "../app/shopify.server";
import {
  collectCustomerData,
  describeCustomerFootprint,
  redactCustomerRecords,
  wipeShopData,
} from "../app/lib/gdpr.server";
import { action as dataRequestAction } from "../app/routes/webhooks.customers.data_request";
import { action as customerRedactAction } from "../app/routes/webhooks.customers.redact";
import { action as shopRedactAction } from "../app/routes/webhooks.shop.redact";

const mockWebhook = authenticate.webhook as unknown as ReturnType<typeof vi.fn>;

describe("GDPR webhooks", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns a no-data response for customers/data_request when nothing is stored", async () => {
    mockWebhook.mockResolvedValue({
      shop: "demo.myshopify.com",
      topic: "customers/data_request",
      payload: { customer_id: 1 },
    });

    vi.mocked(describeCustomerFootprint).mockResolvedValue({ hasData: false, orders: 0, customers: 0 });

    const response = await dataRequestAction({ request: new Request("http://test", { method: "POST" }) } as any);
    const body = await response.json();

    expect(body.ok).toBe(true);
    expect(body.message).toContain("No customer-level data stored");
    expect(describeCustomerFootprint).toHaveBeenCalledWith("demo.myshopify.com", ["gid://shopify/Customer/1"]);
    expect(collectCustomerData).not.toHaveBeenCalled();
  });

  it("exports stored records when customers/data_request finds a footprint", async () => {
    mockWebhook.mockResolvedValue({
      shop: "demo.myshopify.com",
      topic: "customers/data_request",
      payload: { customer_id: 1, orders_requested: [10] },
    });

    vi.mocked(describeCustomerFootprint).mockResolvedValue({ hasData: true, orders: 2, customers: 1 });
    vi.mocked(collectCustomerData).mockResolvedValue({
      orders: [{ id: "gid://shopify/Order/10", products: [] }],
      customers: [{ id: "gid://shopify/Customer/1", shopDomain: "demo.myshopify.com", platform: "shopify", acquiredViaAi: false, firstOrderId: null, firstOrderAt: null, lastOrderAt: null, orderCount: 0, totalSpent: 0, firstAiOrderId: null, createdAt: new Date(), updatedAt: new Date() }],
    } as any);

    const response = await dataRequestAction({ request: new Request("http://test", { method: "POST" }) } as any);
    const body = await response.json();

    expect(body.ok).toBe(true);
    expect(body.export?.orders?.[0]?.id).toBe("gid://shopify/Order/10");
    expect(body.export?.customers?.[0]?.id).toBe("gid://shopify/Customer/1");
    expect(collectCustomerData).toHaveBeenCalledWith(
      "demo.myshopify.com",
      ["gid://shopify/Customer/1"],
      ["gid://shopify/Order/10"],
    );
  });

  it("deletes customer and order rows for customers/redact", async () => {
    mockWebhook.mockResolvedValue({
      shop: "demo.myshopify.com",
      topic: "customers/redact",
      payload: { customer_id: 1, orders_to_redact: [10, 11] },
    });

    const response = await customerRedactAction({ request: new Request("http://test", { method: "POST" }) } as any);

    expect(response.status).toBe(200);
    expect(redactCustomerRecords).toHaveBeenCalledWith(
      "demo.myshopify.com",
      ["gid://shopify/Customer/1"],
      ["gid://shopify/Order/10", "gid://shopify/Order/11"],
    );
  });

  it("wipes all shop data for shop/redact", async () => {
    mockWebhook.mockResolvedValue({
      shop: "demo.myshopify.com",
      topic: "shop/redact",
      payload: { shop_domain: "other.myshopify.com" },
    });

    const response = await shopRedactAction({ request: new Request("http://test", { method: "POST" }) } as any);

    expect(response.status).toBe(200);
    expect(wipeShopData).toHaveBeenCalledWith("other.myshopify.com");
  });
});
