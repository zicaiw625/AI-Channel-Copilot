-- Ensure ShopSettings has a platform column compatible with current schema
ALTER TABLE "ShopSettings"
  ADD COLUMN IF NOT EXISTS "platform" TEXT DEFAULT 'shopify';

-- Backfill null platforms to 'shopify'
UPDATE "ShopSettings" SET "platform" = 'shopify' WHERE "platform" IS NULL;

-- Composite unique index used by Prisma (map: shopDomain_platform)
CREATE UNIQUE INDEX IF NOT EXISTS "shopDomain_platform" ON "ShopSettings" ("shopDomain", "platform");

-- Helper composite index for queries
CREATE INDEX IF NOT EXISTS "ShopSettings_shopDomain_platform_idx" ON "ShopSettings" ("shopDomain", "platform");

