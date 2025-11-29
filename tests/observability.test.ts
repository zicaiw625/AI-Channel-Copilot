import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getGraphqlMetricsSnapshot,
  onGraphqlMetrics,
  recordGraphqlCall,
  resetGraphqlMetrics,
} from "../app/lib/observability.server";

describe("Shopify GraphQL observability", () => {
  afterEach(() => {
    resetGraphqlMetrics();
    onGraphqlMetrics(null);
    vi.restoreAllMocks();
  });

  it("records successes and failures and forwards metrics to a sink", () => {
    const sink = vi.fn();
    onGraphqlMetrics(sink);

    recordGraphqlCall({
      operation: "Products",
      durationMs: 120,
      retries: 1,
      status: 200,
      ok: true,
    });
    recordGraphqlCall({
      operation: "Products",
      durationMs: 150,
      retries: 2,
      status: 500,
      ok: false,
      error: "server error",
    });

    const snapshot = getGraphqlMetricsSnapshot();
    expect(snapshot.Products.success).toBe(1);
    expect(snapshot.Products.failure).toBe(1);
    expect(sink).toHaveBeenCalledWith("Products", expect.objectContaining({ success: 1, failure: 1 }));
  });

  it("raises a warn log when failure rate stays above the threshold", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    for (let i = 0; i < 8; i += 1) {
      recordGraphqlCall({ operation: "Orders", durationMs: 90, retries: 0, status: 200, ok: true });
    }
    for (let i = 0; i < 2; i += 1) {
      recordGraphqlCall({
        operation: "Orders",
        durationMs: 110,
        retries: 1,
        status: 500,
        ok: false,
        error: "boom",
      });
    }

    expect(warnSpy).toHaveBeenCalledWith(
      "[shopify][graphql] elevated failure rate",
      expect.objectContaining({ failureRate: expect.any(Number), attempts: 10 }),
    );
  });
});
