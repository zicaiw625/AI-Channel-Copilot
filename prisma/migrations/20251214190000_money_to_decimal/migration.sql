-- Convert monetary columns from DOUBLE PRECISION (Float) to NUMERIC(12,2) (Decimal)
-- Rationale:
-- - Avoid floating point accumulation errors for GMV/LTV/refund calculations
-- - Ensure deterministic rounding behavior for exports & billing analytics

ALTER TABLE "Customer"
  ALTER COLUMN "totalSpent" TYPE NUMERIC(12,2) USING ROUND("totalSpent"::numeric, 2),
  ALTER COLUMN "totalSpent" SET DEFAULT 0;

ALTER TABLE "Order"
  ALTER COLUMN "totalPrice" TYPE NUMERIC(12,2) USING ROUND("totalPrice"::numeric, 2),
  ALTER COLUMN "subtotalPrice" TYPE NUMERIC(12,2) USING CASE
    WHEN "subtotalPrice" IS NULL THEN NULL
    ELSE ROUND("subtotalPrice"::numeric, 2)
  END,
  ALTER COLUMN "refundTotal" TYPE NUMERIC(12,2) USING ROUND("refundTotal"::numeric, 2),
  ALTER COLUMN "refundTotal" SET DEFAULT 0;

ALTER TABLE "OrderProduct"
  ALTER COLUMN "price" TYPE NUMERIC(12,2) USING ROUND("price"::numeric, 2);

ALTER TABLE "Checkout"
  ALTER COLUMN "totalPrice" TYPE NUMERIC(12,2) USING ROUND("totalPrice"::numeric, 2),
  ALTER COLUMN "totalPrice" SET DEFAULT 0,
  ALTER COLUMN "subtotalPrice" TYPE NUMERIC(12,2) USING CASE
    WHEN "subtotalPrice" IS NULL THEN NULL
    ELSE ROUND("subtotalPrice"::numeric, 2)
  END;

