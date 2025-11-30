-- Safe patch migration: add missing columns and indexes if not present

-- WebhookJob columns
ALTER TABLE "WebhookJob" ADD COLUMN IF NOT EXISTS "externalId" TEXT;
ALTER TABLE "WebhookJob" ADD COLUMN IF NOT EXISTS "orderId" TEXT;
ALTER TABLE "WebhookJob" ADD COLUMN IF NOT EXISTS "eventTime" TIMESTAMP(3);
ALTER TABLE "WebhookJob" ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "WebhookJob" ADD COLUMN IF NOT EXISTS "nextRunAt" TIMESTAMP(3);

-- WebhookJob indexes
CREATE UNIQUE INDEX IF NOT EXISTS "webhook_unique_external" ON "WebhookJob"("shopDomain", "topic", "externalId");
CREATE INDEX IF NOT EXISTS "WebhookJob_status_nextRunAt_idx" ON "WebhookJob"("status", "nextRunAt");
CREATE INDEX IF NOT EXISTS "WebhookJob_shopDomain_topic_orderId_idx" ON "WebhookJob"("shopDomain", "topic", "orderId");

-- Order columns
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "refundTotal" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Order indexes
CREATE INDEX IF NOT EXISTS "orders_shop_date_desc" ON "Order"("shopDomain", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "orders_shop_ai_desc" ON "Order"("shopDomain", "aiSource", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "orders_ai_id" ON "Order"("aiSource", "id");

