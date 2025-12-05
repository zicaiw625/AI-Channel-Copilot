-- Add llms.txt cache fields to ShopSettings
ALTER TABLE "ShopSettings" ADD COLUMN IF NOT EXISTS "llmsTxtCache" TEXT;
ALTER TABLE "ShopSettings" ADD COLUMN IF NOT EXISTS "llmsTxtCachedAt" TIMESTAMP(3);
