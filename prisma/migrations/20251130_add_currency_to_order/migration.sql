ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "currency" TEXT DEFAULT 'USD';
UPDATE "Order" SET "currency" = 'USD' WHERE "currency" IS NULL;
