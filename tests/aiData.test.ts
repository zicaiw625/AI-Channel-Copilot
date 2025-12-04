import { describe, expect, it } from "vitest";
import {
  buildDashboardFromOrders,
  defaultSettings,
  detectAiFromFields,
  mapShopifyOrderToRecord,
  type DateRange,
  type ShopifyOrderNode,
} from "../app/lib/aiData";
import { extractGdprIdentifiers } from "../app/lib/gdpr.server";

describe("AI source detection", () => {
  it("detects AI referrers from default domain list", () => {
    const { aiSource } = detectAiFromFields(
      "https://chat.openai.com/share/abc",
      "",
      undefined,
      undefined,
      [],
      undefined,
      {
        aiDomains: defaultSettings.aiDomains,
        utmSources: defaultSettings.utmSources,
        utmMediumKeywords: defaultSettings.utmMediumKeywords,
      },
    );

    expect(aiSource).toBe("ChatGPT");
  });

  it("honors explicit UTM sources when no referrer is present", () => {
    const { aiSource } = detectAiFromFields(
      "",
      "https://demo.ai/?utm_source=perplexity&utm_medium=ai-agent",
      "perplexity",
      "ai-agent",
      [],
      undefined,
      {
        aiDomains: defaultSettings.aiDomains,
        utmSources: defaultSettings.utmSources,
        utmMediumKeywords: defaultSettings.utmMediumKeywords,
      },
    );

    expect(aiSource).toBe("Perplexity");
  });
});

describe("Order mapping and aggregation", () => {
  const range: DateRange = {
    key: "custom",
    label: "range",
    start: new Date("2024-01-01T00:00:00Z"),
    end: new Date("2024-01-31T23:59:59Z"),
    days: 30,
  };

  it("maps Shopify order nodes with currency and new customer flags", () => {
    const order: ShopifyOrderNode = {
      id: "gid://shopify/Order/1",
      name: "#1001",
      createdAt: "2024-01-10T12:00:00Z",
      currentTotalPriceSet: { shopMoney: { amount: "120.50", currencyCode: "USD" } },
      currentSubtotalPriceSet: { shopMoney: { amount: "100.00", currencyCode: "USD" } },
      customerJourneySummary: { firstVisit: { referrerUrl: "https://chat.openai.com/" } },
      landingPageUrl: "https://store.example.com/landing?utm_source=chatgpt",
      sourceName: "web",
      tags: [],
      noteAttributes: [{ name: "ai-channel", value: "ChatGPT" }],
      customer: { id: "gid://shopify/Customer/1", numberOfOrders: 1 },
      lineItems: {
        edges: [
          {
            node: {
              id: "gid://shopify/LineItem/1",
              name: "Item",
              quantity: 2,
              originalUnitPriceSet: { shopMoney: { amount: "60.25", currencyCode: "USD" } },
              variant: { product: { id: "gid://shopify/Product/1", title: "Item" } },
            },
          },
        ],
      },
    };

    const record = mapShopifyOrderToRecord(order, defaultSettings);

    expect(record.currency).toBe("USD");
    expect(record.products[0]?.currency).toBe("USD");
    expect(record.isNewCustomer).toBe(true);
  });

  it("aggregates AI metrics into dashboard outputs", () => {
    const orders = [
      {
        id: "o1",
        name: "#1",
        createdAt: "2024-01-10T00:00:00Z",
        totalPrice: 120,
        currency: "USD",
        subtotalPrice: 100,
        aiSource: "ChatGPT" as const,
        referrer: "https://chat.openai.com/",
        landingPage: "https://store.example.com/",
        utmSource: "chatgpt",
        utmMedium: "ai-agent",
        sourceName: "web",
        customerId: "c1",
        isNewCustomer: true,
        products: [],
        detection: "referrer match",
        signals: [],
        tags: [],
      },
      {
        id: "o2",
        name: "#2",
        createdAt: "2024-01-11T00:00:00Z",
        totalPrice: 80,
        currency: "USD",
        aiSource: null,
        referrer: "",
        landingPage: "",
        utmSource: undefined,
        utmMedium: undefined,
        sourceName: "web",
        customerId: "c2",
        isNewCustomer: false,
        products: [],
        detection: "none",
        signals: [],
        tags: [],
      },
    ];

    const dashboard = buildDashboardFromOrders(orders, range, "current_total_price", undefined, "USD");

    expect(dashboard.overview.totalGMV).toBeCloseTo(200);
    expect(dashboard.overview.aiGMV).toBeCloseTo(120);
    expect(dashboard.overview.aiOrders).toBe(1);
    expect(dashboard.channels.find((c) => c.channel === "ChatGPT")?.gmv).toBeCloseTo(120);
  });

  it("filters non-primary currencies when aggregating GMV", () => {
    const orders = [
      {
        id: "usd-order",
        name: "#1",
        createdAt: "2024-01-05T00:00:00Z",
        totalPrice: 100,
        currency: "USD",
        aiSource: "ChatGPT" as const,
        referrer: "https://chat.openai.com/",
        landingPage: "https://store.example.com/",
        utmSource: "chatgpt",
        utmMedium: "ai-agent",
        sourceName: "web",
        customerId: "c1",
        isNewCustomer: true,
        products: [],
        detection: "referrer match",
        signals: [],
        tags: [],
      },
      {
        id: "eur-order",
        name: "#2",
        createdAt: "2024-01-06T00:00:00Z",
        totalPrice: 200,
        currency: "EUR",
        aiSource: null,
        referrer: "",
        landingPage: "",
        utmSource: undefined,
        utmMedium: undefined,
        sourceName: "web",
        customerId: "c2",
        isNewCustomer: false,
        products: [],
        detection: "none",
        signals: [],
        tags: [],
      },
    ];

    const dashboard = buildDashboardFromOrders(orders, range, "current_total_price", undefined, "USD");

    expect(dashboard.overview.totalGMV).toBe(100);
    expect(dashboard.overview.currency).toBe("USD");
    expect(dashboard.sampleNote).toContain("已过滤 1 笔非 USD 货币的订单");
    expect(dashboard.recentOrders).toHaveLength(1);
  });
});

describe("GDPR identifier extraction", () => {
  it("deduplicates ids and returns normalized gid variants", () => {
    const result = extractGdprIdentifiers({
      customer_id: 1234,
      orders_to_redact: ["5678", "gid://shopify/Order/5678"],
      customer_email: "test@example.com",
    });

    expect(result.customerIds).toContain("gid://shopify/Customer/1234");
    expect(result.customerIds).toContain("1234");
    expect(result.orderIds).toHaveLength(2);
    expect(result.customerEmail).toBe("test@example.com");
  });
});
