DO $$
BEGIN
  CREATE TYPE "AiSource" AS ENUM ('ChatGPT', 'Perplexity', 'Gemini', 'Copilot', 'Other_AI');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DROP INDEX IF EXISTS "ShopSettings_shopDomain_key";

UPDATE "Customer" SET "platform" = COALESCE("platform", 'shopify') WHERE "platform" IS NULL;
ALTER TABLE "Customer"
  ALTER COLUMN "updatedAt" DROP DEFAULT,
  ALTER COLUMN "platform" SET NOT NULL;

UPDATE "Order" SET "platform" = COALESCE("platform", 'shopify') WHERE "platform" IS NULL;
UPDATE "Order" SET "currency" = COALESCE("currency", 'USD') WHERE "currency" IS NULL;
ALTER TABLE "Order" ALTER COLUMN "currency" SET DEFAULT 'USD';
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "refundTotal" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Order" DROP COLUMN IF EXISTS "aiSource";
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "aiSource" "AiSource";
ALTER TABLE "Order" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "Order" ALTER COLUMN "platform" SET NOT NULL;
ALTER TABLE "Order" ALTER COLUMN "currency" SET NOT NULL;

ALTER TABLE "OrderProduct" ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'USD';

UPDATE "ShopSettings" SET "platform" = COALESCE("platform", 'shopify') WHERE "platform" IS NULL;
UPDATE "ShopSettings" SET "taggingDryRun" = COALESCE("taggingDryRun", true) WHERE "taggingDryRun" IS NULL;
ALTER TABLE "ShopSettings"
  ALTER COLUMN "updatedAt" DROP DEFAULT,
  ALTER COLUMN "taggingDryRun" SET NOT NULL,
  ALTER COLUMN "platform" SET NOT NULL;

ALTER TABLE "WebhookJob"
  ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "eventTime" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "externalId" TEXT,
  ADD COLUMN IF NOT EXISTS "nextRunAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "orderId" TEXT;

CREATE INDEX IF NOT EXISTS "Order_shopDomain_platform_createdAt_idx" ON "Order"("shopDomain", "platform", "createdAt");

CREATE INDEX IF NOT EXISTS "Order_shopDomain_aiSource_idx" ON "Order"("shopDomain", "aiSource");

CREATE INDEX IF NOT EXISTS "orders_shop_date_desc" ON "Order"("shopDomain", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "orders_shop_ai_desc" ON "Order"("shopDomain", "aiSource", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "orders_ai_id" ON "Order"("aiSource", "id");

CREATE INDEX IF NOT EXISTS "WebhookJob_shopDomain_topic_orderId_idx" ON "WebhookJob"("shopDomain", "topic", "orderId");

CREATE INDEX IF NOT EXISTS "WebhookJob_status_nextRunAt_idx" ON "WebhookJob"("status", "nextRunAt");

CREATE UNIQUE INDEX IF NOT EXISTS "webhook_unique_external" ON "WebhookJob"("shopDomain", "topic", "externalId");
