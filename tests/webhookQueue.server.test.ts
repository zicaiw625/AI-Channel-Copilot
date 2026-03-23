/**
 * Webhook Queue 测试
 * 
 * 测试覆盖:
 * - 去重逻辑 (checkWebhookDuplicate)
 * - Handler 注册与获取
 * - 内存保护机制
 * - 任务清理
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Prisma } from "@prisma/client";

// Mock Prisma
vi.mock("../app/db.server", () => ({
  default: {
    webhookJob: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
    $transaction: vi.fn((fn) => fn({
      webhookJob: {
        findFirst: vi.fn(),
        updateMany: vi.fn(),
        findUnique: vi.fn(),
      },
    })),
  },
}));

// Mock locks
vi.mock("../app/lib/locks.server", () => ({
  withAdvisoryLockSimple: vi.fn((_, fn) => fn()),
}));

// Mock logger
vi.mock("../app/lib/logger.server", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock env config
vi.mock("../app/lib/env.server", () => ({
  getQueueConfig: () => ({
    maxRetries: 5,
    baseDelayMs: 500,
    maxDelayMs: 30000,
    pendingCooldownMs: 250,
    pendingMaxCooldownMs: 2000,
    maxBatch: 50,
  }),
}));

describe("Webhook Queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("checkWebhookDuplicate", () => {
    it("应该检测到重复的 webhook", async () => {
      const prisma = await import("../app/db.server");
      (prisma.default.webhookJob.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 1,
        status: "completed",
      });

      const { checkWebhookDuplicate } = await import("../app/lib/webhookQueue.server");
      
      const isDuplicate = await checkWebhookDuplicate(
        "test-shop.myshopify.com",
        "orders/create",
        "webhook-123"
      );

      expect(isDuplicate).toBe(true);
      expect(prisma.default.webhookJob.findFirst).toHaveBeenCalledWith({
        where: {
          shopDomain: "test-shop.myshopify.com",
          topic: "orders/create",
          externalId: "webhook-123",
          status: { in: ["queued", "processing", "completed"] },
        },
        select: { id: true, status: true },
      });
    });

    it("当 webhook 不存在时应返回 false", async () => {
      const prisma = await import("../app/db.server");
      (prisma.default.webhookJob.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const { checkWebhookDuplicate } = await import("../app/lib/webhookQueue.server");
      
      const isDuplicate = await checkWebhookDuplicate(
        "test-shop.myshopify.com",
        "orders/create",
        "webhook-456"
      );

      expect(isDuplicate).toBe(false);
    });

    it("当已有 failed 任务时不应视为重复", async () => {
      const prisma = await import("../app/db.server");
      (prisma.default.webhookJob.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const { checkWebhookDuplicate } = await import("../app/lib/webhookQueue.server");
      
      const isDuplicate = await checkWebhookDuplicate(
        "test-shop.myshopify.com",
        "orders/create",
        "webhook-failed"
      );

      expect(isDuplicate).toBe(false);
      expect(prisma.default.webhookJob.findFirst).toHaveBeenCalledWith({
        where: {
          shopDomain: "test-shop.myshopify.com",
          topic: "orders/create",
          externalId: "webhook-failed",
          status: { in: ["queued", "processing", "completed"] },
        },
        select: { id: true, status: true },
      });
    });

    it("当 externalId 为空时应返回 false", async () => {
      const { checkWebhookDuplicate } = await import("../app/lib/webhookQueue.server");
      
      const isDuplicate = await checkWebhookDuplicate(
        "test-shop.myshopify.com",
        "orders/create",
        ""
      );

      expect(isDuplicate).toBe(false);
    });

    it("查询失败时应返回 false 并继续处理", async () => {
      const prisma = await import("../app/db.server");
      (prisma.default.webhookJob.findFirst as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Database error")
      );

      const { checkWebhookDuplicate } = await import("../app/lib/webhookQueue.server");
      
      const isDuplicate = await checkWebhookDuplicate(
        "test-shop.myshopify.com",
        "orders/create",
        "webhook-789"
      );

      expect(isDuplicate).toBe(false);
    });
  });

  describe("registerWebhookHandler", () => {
    it("应该正确注册 handler", async () => {
      const { registerWebhookHandler } = await import("../app/lib/webhookQueue.server");
      
      const mockHandler = vi.fn();
      registerWebhookHandler("test-intent", mockHandler);

      // Handler 应该被注册，可以通过内部机制验证
      // 这里主要测试不抛出异常
      expect(() => registerWebhookHandler("test-intent-2", mockHandler)).not.toThrow();
    });
  });

  describe("getWebhookQueueSize", () => {
    it("应该返回队列中的任务数量", async () => {
      const prisma = await import("../app/db.server");
      (prisma.default.webhookJob.count as ReturnType<typeof vi.fn>).mockResolvedValue(10);

      const { getWebhookQueueSize } = await import("../app/lib/webhookQueue.server");
      
      const size = await getWebhookQueueSize();

      expect(size).toBe(10);
      expect(prisma.default.webhookJob.count).toHaveBeenCalledWith({
        where: { status: { in: ["queued", "processing"] } },
      });
    });
  });

  describe("getDeadLetterJobs", () => {
    it("应该返回失败的任务", async () => {
      const mockFailedJobs = [
        { id: 1, status: "failed", error: "Test error" },
        { id: 2, status: "failed", error: "Another error" },
      ];
      
      const prisma = await import("../app/db.server");
      (prisma.default.webhookJob.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(mockFailedJobs);

      const { getDeadLetterJobs } = await import("../app/lib/webhookQueue.server");
      
      const deadLetterJobs = await getDeadLetterJobs(50);

      expect(deadLetterJobs).toHaveLength(2);
      expect(prisma.default.webhookJob.findMany).toHaveBeenCalledWith({
        where: { status: "failed" },
        orderBy: { finishedAt: "desc" },
        take: 50,
      });
    });
  });

  describe("wakeupDueWebhookJobs", () => {
    it("应该唤醒待处理的任务", async () => {
      const prisma = await import("../app/db.server");
      (prisma.default.webhookJob.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue([
        { shopDomain: "shop1.myshopify.com", _count: { _all: 5 } },
        { shopDomain: "shop2.myshopify.com", _count: { _all: 3 } },
      ]);

      const { wakeupDueWebhookJobs } = await import("../app/lib/webhookQueue.server");
      
      const result = await wakeupDueWebhookJobs();

      expect(result.shopsWoken).toBe(2);
    });

    it("当没有待处理任务时应返回 0", async () => {
      const prisma = await import("../app/db.server");
      (prisma.default.webhookJob.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const { wakeupDueWebhookJobs } = await import("../app/lib/webhookQueue.server");
      
      const result = await wakeupDueWebhookJobs();

      expect(result.shopsWoken).toBe(0);
    });
  });

  describe("cleanupWebhookTimers", () => {
    it("应该清理所有定时器", async () => {
      const { cleanupWebhookTimers } = await import("../app/lib/webhookQueue.server");
      
      // 应该不抛出异常
      expect(() => cleanupWebhookTimers()).not.toThrow();
    });
  });
});

describe("边界条件测试", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Payload 大小限制", () => {
    it("应该拒绝过大的 payload", async () => {
      const prisma = await import("../app/db.server");
      const logger = await import("../app/lib/logger.server");
      
      const { enqueueWebhookJob } = await import("../app/lib/webhookQueue.server");
      
      // 创建一个超过 64KB 的 payload
      const largePayload: Record<string, string> = {};
      for (let i = 0; i < 10000; i++) {
        largePayload[`key${i}`] = "x".repeat(10);
      }
      
      await expect(enqueueWebhookJob({
        shopDomain: "test-shop.myshopify.com",
        topic: "orders/create",
        intent: "orders/create",
        payload: largePayload,
        run: vi.fn(),
      })).rejects.toThrow(/Webhook enqueue failed: payload/);
      
      // 应该记录错误日志
      expect(logger.logger.error).toHaveBeenCalled();
      // 不应该创建任务
      expect(prisma.default.webhookJob.create).not.toHaveBeenCalled();
    });
  });

  describe("失败任务重入", () => {
    it("当唯一键冲突对应 failed 任务时应 reclaim 并重新入队", async () => {
      const prisma = await import("../app/db.server");

      const duplicateError = new Prisma.PrismaClientKnownRequestError(
        "Unique constraint failed",
        {
          code: "P2002",
          clientVersion: "test",
          meta: { target: ["shopDomain", "topic", "externalId"] },
        },
      );

      (prisma.default.webhookJob.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce(duplicateError);
      (prisma.default.webhookJob.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 42,
        status: "failed",
      });
      (prisma.default.webhookJob.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });
      (prisma.default.webhookJob.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);

      const { enqueueWebhookJob } = await import("../app/lib/webhookQueue.server");

      const result = await enqueueWebhookJob({
        shopDomain: "test-shop.myshopify.com",
        topic: "orders/create",
        intent: "orders/create",
        payload: { orderId: "gid://shopify/Order/1" },
        externalId: "webhook-123",
        orderId: "gid://shopify/Order/1",
        run: vi.fn(),
      });

      expect(result).toEqual({ status: "enqueued" });
      expect(prisma.default.webhookJob.updateMany).toHaveBeenCalledWith({
        where: { id: 42, status: "failed" },
        data: expect.objectContaining({
          status: "queued",
          attempts: 0,
          error: null,
        }),
      });
    });
  });

  describe("空值处理", () => {
    it("应该拒绝空的 shopDomain", async () => {
      const prisma = await import("../app/db.server");
      const logger = await import("../app/lib/logger.server");
      
      const { enqueueWebhookJob } = await import("../app/lib/webhookQueue.server");
      
      await expect(enqueueWebhookJob({
        shopDomain: "",
        topic: "orders/create",
        intent: "orders/create",
        payload: { test: true },
        run: vi.fn(),
      })).rejects.toThrow("Webhook enqueue failed: missing shopDomain");
      
      // 应该记录警告日志
      expect(logger.logger.warn).toHaveBeenCalled();
      // 不应该创建任务
      expect(prisma.default.webhookJob.create).not.toHaveBeenCalled();
    });

    it("应该拒绝非对象类型的 payload", async () => {
      const prisma = await import("../app/db.server");
      const logger = await import("../app/lib/logger.server");
      
      const { enqueueWebhookJob } = await import("../app/lib/webhookQueue.server");
      
      await expect(enqueueWebhookJob({
        shopDomain: "test-shop.myshopify.com",
        topic: "orders/create",
        intent: "orders/create",
        payload: null as unknown as Record<string, unknown>,
        run: vi.fn(),
      })).rejects.toThrow("Webhook enqueue failed: payload must be object");
      
      // 应该记录警告日志
      expect(logger.logger.warn).toHaveBeenCalled();
      // 不应该创建任务
      expect(prisma.default.webhookJob.create).not.toHaveBeenCalled();
    });
  });
});
