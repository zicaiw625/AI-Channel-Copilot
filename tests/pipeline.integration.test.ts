import { beforeEach, describe, expect, it, vi } from "vitest";

import { defaultSettings } from "../app/lib/aiData";
import { action as orderCreateAction } from "../app/routes/webhooks.orders.create";
import { loader as dashboardLoader } from "../app/routes/app._index";
import { authenticate } from "../app/shopify.server";
import { fetchOrderById } from "../app/lib/shopifyOrders.server";
import { persistOrders, loadOrdersFromDb } from "../app/lib/persistence.server";
import { applyAiTags } from "../app/lib/tagging.server";
import { getAiDashboardData } from "../app/lib/aiQueries.server";
import { getSettings, syncShopPreferences, markActivity } from "../app/lib/settings.server";
import { isBackfillRunning } from "../app/lib/backfill.server";

vi.mock("../app/shopify.server", () => ({
  authenticate: {
    webhook: vi.fn(),
    admin: vi.fn(),
  },
}));

vi.mock("../app/lib/shopifyOrders.server", () => ({
  fetchOrderById: vi.fn(),
}));

vi.mock("../app/lib/persistence.server", () => ({
  persistOrders: vi.fn(),
  loadOrdersFromDb: vi.fn(),
}));

vi.mock("../app/lib/tagging.server", () => ({
  applyAiTags: vi.fn(),
}));

vi.mock("../app/lib/aiQueries.server", () => ({
  getAiDashboardData: vi.fn(),
}));

vi.mock("../app/lib/settings.server", () => ({
  getSettings: vi.fn(),
  syncShopPreferences: vi.fn((_, __, settings) => settings),
  markActivity: vi.fn(),
  updatePipelineStatuses: vi.fn(),
}));

vi.mock("../app/lib/backfill.server", () => ({
  isBackfillRunning: vi.fn(() => Promise.resolve(false)),
}));

describe("orders webhook to dashboard integration", () => {
  const mockWebhook = authenticate.webhook as unknown as ReturnType<typeof vi.fn>;
  const mockAdminAuth = authenticate.admin as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("processes a webhook order and surfaces it through the dashboard loader", async () => {
    const shopDomain = "demo.myshopify.com";
    mockWebhook.mockResolvedValue({
      admin: {},
      shop: shopDomain,
      topic: "orders/create",
      payload: { id: 123 },
    });

    vi.mocked(getSettings).mockResolvedValue(defaultSettings);
    vi.mocked(fetchOrderById).mockResolvedValue({
      id: "gid://shopify/Order/123",
      aiSource: "ChatGPT",
      detection: "referrer=chatgpt",
      signals: ["referrer:chatgpt"],
      createdAt: new Date(),
    } as any);
    vi.mocked(persistOrders).mockResolvedValue();
    vi.mocked(markActivity).mockResolvedValue();
    vi.mocked(applyAiTags).mockResolvedValue();

    const webhookResponse = await orderCreateAction({
      request: new Request("http://test/webhook", { method: "POST" }),
    } as any);

    expect(webhookResponse.status).toBe(200);
    expect(fetchOrderById).toHaveBeenCalledWith({}, "gid://shopify/Order/123", defaultSettings, {
      shopDomain,
    });
    expect(persistOrders).toHaveBeenCalled();
    expect(markActivity).toHaveBeenCalledWith(shopDomain, expect.objectContaining({ lastOrdersWebhookAt: expect.any(Date) }));

    const dashboardData = {
      overview: { aiShare: 0.2, aiOrders: 1, totalOrders: 2, aiRevenue: 10, totalRevenue: 50 },
      channels: [],
      comparison: [],
      trend: [],
      topProducts: [],
      recentOrders: [
        {
          id: "gid://shopify/Order/123",
          name: "#1001",
          aiSource: "ChatGPT",
          detection: "referrer=chatgpt",
          signals: ["referrer:chatgpt"],
        },
      ],
      sampleNote: null,
      exports: { ordersCsv: "", productsCsv: "" },
    } as any;

    vi.mocked(getAiDashboardData).mockResolvedValue({ data: dashboardData, orders: dashboardData.recentOrders });
    vi.mocked(loadOrdersFromDb).mockResolvedValue({ orders: dashboardData.recentOrders as any, clamped: false });
    mockAdminAuth.mockResolvedValue({ admin: {}, session: { shop: shopDomain } });

    const loaderResult = await dashboardLoader({ request: new Request("http://test/app") } as any);

    expect(loaderResult.data.recentOrders[0].aiSource).toBe("ChatGPT");
    expect(loaderResult.data.recentOrders[0].signals?.[0]).toContain("referrer:chatgpt");
    expect(loadOrdersFromDb).toHaveBeenCalled();
    expect(isBackfillRunning).toHaveBeenCalledWith(shopDomain);
  });
});
