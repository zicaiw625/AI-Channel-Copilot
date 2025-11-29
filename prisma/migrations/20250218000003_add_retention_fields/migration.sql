-- Add retention months and cleanup tracking
ALTER TABLE "ShopSettings"
ADD COLUMN IF NOT EXISTS "retentionMonths" INTEGER NOT NULL DEFAULT 6,
ADD COLUMN IF NOT EXISTS "lastCleanupAt" TIMESTAMP(3);
