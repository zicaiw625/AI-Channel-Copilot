import { describe, expect, it } from "vitest";

import { defaultSettings } from "../app/lib/aiData";
import { mergeSettingsForSave } from "../app/lib/settings/utils";

describe("mergeSettingsForSave", () => {
  it("preserves server-managed activity timestamps from existing settings", () => {
    const existing = {
      ...defaultSettings,
      lastOrdersWebhookAt: "2026-03-20T00:00:00.000Z",
      lastBackfillAt: "2026-03-21T00:00:00.000Z",
      lastBackfillAttemptAt: "2026-03-21T01:00:00.000Z",
      lastBackfillOrdersFetched: 12,
      lastTaggingAt: "2026-03-22T00:00:00.000Z",
      lastCleanupAt: "2026-03-22T01:00:00.000Z",
    };

    const normalized = {
      ...defaultSettings,
      languages: ["English"],
      timezones: ["Asia/Shanghai"],
      lastOrdersWebhookAt: null,
      lastBackfillAt: null,
      lastBackfillAttemptAt: null,
      lastBackfillOrdersFetched: null,
      lastTaggingAt: null,
      lastCleanupAt: null,
    };

    const merged = mergeSettingsForSave(existing, normalized);

    expect(merged.languages).toEqual(["English"]);
    expect(merged.timezones).toEqual(["Asia/Shanghai"]);
    expect(merged.lastOrdersWebhookAt).toBe(existing.lastOrdersWebhookAt);
    expect(merged.lastBackfillAt).toBe(existing.lastBackfillAt);
    expect(merged.lastBackfillAttemptAt).toBe(existing.lastBackfillAttemptAt);
    expect(merged.lastBackfillOrdersFetched).toBe(existing.lastBackfillOrdersFetched);
    expect(merged.lastTaggingAt).toBe(existing.lastTaggingAt);
    expect(merged.lastCleanupAt).toBe(existing.lastCleanupAt);
  });
});
