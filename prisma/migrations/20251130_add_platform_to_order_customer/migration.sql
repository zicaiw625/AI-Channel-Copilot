-- Add platform columns to Order and Customer to match current Prisma schema
ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "platform" TEXT DEFAULT 'shopify';

ALTER TABLE "Customer"
  ADD COLUMN IF NOT EXISTS "platform" TEXT DEFAULT 'shopify';

-- Backfill nulls
UPDATE "Order" SET "platform" = 'shopify' WHERE "platform" IS NULL;
UPDATE "Customer" SET "platform" = 'shopify' WHERE "platform" IS NULL;

-- Helper indexes for queries filtering by shopDomain + platform
CREATE INDEX IF NOT EXISTS "Order_shopDomain_platform_idx" ON "Order" ("shopDomain", "platform");
CREATE INDEX IF NOT EXISTS "Customer_shopDomain_platform_idx" ON "Customer" ("shopDomain", "platform");

