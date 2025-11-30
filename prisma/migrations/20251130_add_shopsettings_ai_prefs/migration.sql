-- Add missing JSON column for AI exposure preferences to match Prisma schema
ALTER TABLE "ShopSettings"
  ADD COLUMN IF NOT EXISTS "aiExposurePreferences" JSONB;

-- Initialize to empty object where null to prevent runtime mapping issues
UPDATE "ShopSettings"
SET "aiExposurePreferences" = '{}'::jsonb
WHERE "aiExposurePreferences" IS NULL;

