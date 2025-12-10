-- Migration: Remove Checkout.email PII, replace with hasEmail boolean
-- This migration removes the email field from Checkout table to comply with
-- PII minimization requirements and Shopify's protected customer data policies.

-- Step 1: Add the new hasEmail column
ALTER TABLE "Checkout" ADD COLUMN "hasEmail" BOOLEAN NOT NULL DEFAULT false;

-- Step 2: Migrate existing data - set hasEmail = true where email was not null/empty
UPDATE "Checkout" SET "hasEmail" = true WHERE "email" IS NOT NULL AND "email" != '';

-- Step 3: Drop the email column (contains PII)
ALTER TABLE "Checkout" DROP COLUMN "email";
