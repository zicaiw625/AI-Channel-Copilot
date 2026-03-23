import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMocks = vi.hoisted(() => ({
  checkout: {
    upsert: vi.fn(),
    findUnique: vi.fn(),
  },
}));

vi.mock("../app/db.server", () => ({
  default: prismaMocks,
}));

vi.mock("../app/lib/logger.server", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { processCheckoutCreate, processCheckoutUpdate } from "../app/lib/funnelService.server";

const settings = {
  aiDomains: [],
  utmSources: [],
  utmMediumKeywords: [],
};

describe("funnelService checkout processing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMocks.checkout.findUnique.mockResolvedValue(null);
  });

  it("rethrows checkout create persistence errors so queue retry can happen", async () => {
    prismaMocks.checkout.upsert.mockRejectedValue(new Error("db down"));

    await expect(
      processCheckoutCreate(
        "demo.myshopify.com",
        {
          id: "checkout-1",
          created_at: "2026-03-01T00:00:00Z",
          updated_at: "2026-03-01T00:00:00Z",
          total_price: "100",
          currency: "USD",
        },
        settings,
      ),
    ).rejects.toThrow("db down");
  });

  it("rethrows checkout update persistence errors so queue retry can happen", async () => {
    prismaMocks.checkout.upsert.mockRejectedValue(new Error("db update failed"));

    await expect(
      processCheckoutUpdate(
        "demo.myshopify.com",
        {
          id: "checkout-2",
          created_at: "2026-03-01T00:00:00Z",
          updated_at: "2026-03-01T00:00:00Z",
          total_price: "100",
          currency: "USD",
        },
        settings,
      ),
    ).rejects.toThrow("db update failed");
  });
});
