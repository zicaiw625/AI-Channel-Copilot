import { describe, expect, it } from "vitest";

import { didFetchOrdersComplete } from "../app/lib/shopifyOrders.server";

describe("didFetchOrdersComplete", () => {
  it("returns true when the fetch completed without truncation", () => {
    expect(
      didFetchOrdersComplete({
        error: undefined,
        hitPageLimit: false,
        hitOrderLimit: false,
        hitDurationLimit: false,
      }),
    ).toBe(true);
  });

  it("returns false when any truncation limit was hit", () => {
    expect(
      didFetchOrdersComplete({
        error: undefined,
        hitPageLimit: true,
        hitOrderLimit: false,
        hitDurationLimit: false,
      }),
    ).toBe(false);

    expect(
      didFetchOrdersComplete({
        error: undefined,
        hitPageLimit: false,
        hitOrderLimit: true,
        hitDurationLimit: false,
      }),
    ).toBe(false);

    expect(
      didFetchOrdersComplete({
        error: undefined,
        hitPageLimit: false,
        hitOrderLimit: false,
        hitDurationLimit: true,
      }),
    ).toBe(false);
  });

  it("returns false when the fetch ended with an error", () => {
    expect(
      didFetchOrdersComplete({
        error: {
          code: "access_denied",
          message: "nope",
          suggestReauth: true,
        },
        hitPageLimit: false,
        hitOrderLimit: false,
        hitDurationLimit: false,
      }),
    ).toBe(false);
  });
});
