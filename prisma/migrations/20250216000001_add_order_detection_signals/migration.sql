-- Add structured detection signals for debugging
ALTER TABLE "Order" ADD COLUMN "detectionSignals" JSONB;
