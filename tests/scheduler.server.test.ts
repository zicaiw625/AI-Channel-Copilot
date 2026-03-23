import { beforeEach, describe, expect, it, vi } from "vitest";

const schedulerMocks = vi.hoisted(() => ({
  shopSettingsFindMany: vi.fn(),
  backfillJobFindFirst: vi.fn(),
  getSettings: vi.fn(),
  startBackfill: vi.fn(),
  processBackfillQueue: vi.fn(),
  cleanupStaleBackfillJobs: vi.fn(),
  ensureRetentionOncePerDay: vi.fn(),
  wakeupDueWebhookJobs: vi.fn(),
  withAdvisoryLock: vi.fn(),
  readAppFlags: vi.fn(),
}));

vi.mock("../app/db.server", () => ({
  default: {
    shopSettings: { findMany: schedulerMocks.shopSettingsFindMany },
    backfillJob: { findFirst: schedulerMocks.backfillJobFindFirst },
  },
}));

vi.mock("../app/lib/settings.server", () => ({
  getSettings: schedulerMocks.getSettings,
}));

vi.mock("../app/lib/backfill.server", () => ({
  startBackfill: schedulerMocks.startBackfill,
  processBackfillQueue: schedulerMocks.processBackfillQueue,
  cleanupStaleBackfillJobs: schedulerMocks.cleanupStaleBackfillJobs,
}));

vi.mock("../app/lib/retention.server", () => ({
  ensureRetentionOncePerDay: schedulerMocks.ensureRetentionOncePerDay,
}));

vi.mock("../app/lib/locks.server", () => ({
  withAdvisoryLock: schedulerMocks.withAdvisoryLock,
}));

vi.mock("../app/lib/env.server", () => ({
  readAppFlags: schedulerMocks.readAppFlags,
}));

vi.mock("../app/lib/webhookQueue.server", () => ({
  wakeupDueWebhookJobs: schedulerMocks.wakeupDueWebhookJobs,
}));

vi.mock("../app/shopify.server", () => ({
  unauthenticated: {
    admin: vi.fn(),
  },
}));

vi.mock("../app/lib/graphqlSdk.server", () => ({
  extractAdminClient: vi.fn(),
}));

vi.mock("../app/lib/logger.server", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { runBackfillSweep } from "../app/lib/scheduler.server";

describe("scheduler backfill sweep", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    schedulerMocks.readAppFlags.mockReturnValue({ enableBackfillSweep: true, enableRetentionSweep: true });
    schedulerMocks.withAdvisoryLock.mockImplementation(async (_key: number, fn: () => Promise<unknown>) => ({
      result: await fn(),
      lockInfo: { acquired: true },
    }));
    schedulerMocks.shopSettingsFindMany.mockResolvedValue([
      { shopDomain: "shop-1.myshopify.com", timezone: "UTC", lastBackfillAt: null },
      { shopDomain: "shop-2.myshopify.com", timezone: "UTC", lastBackfillAt: null },
    ]);
    schedulerMocks.getSettings.mockResolvedValue({ timezones: ["UTC"] });
    schedulerMocks.backfillJobFindFirst.mockResolvedValue(null);
    schedulerMocks.startBackfill.mockResolvedValue({ queued: true });
    schedulerMocks.processBackfillQueue.mockResolvedValue(undefined);
  });

  it("processes backfill queue once after scheduling shops", async () => {
    await runBackfillSweep();

    expect(schedulerMocks.startBackfill).toHaveBeenCalledTimes(2);
    expect(schedulerMocks.processBackfillQueue).toHaveBeenCalledTimes(1);
    expect(typeof schedulerMocks.processBackfillQueue.mock.calls[0]?.[0]).toBe("function");
    expect(schedulerMocks.processBackfillQueue.mock.calls[0]?.[1]).toBeUndefined();
  });
});
