-- AlterTable
ALTER TABLE "ShopSettings"
ADD COLUMN "pipelineStatuses" JSONB,
ADD COLUMN "lastOrdersWebhookAt" TIMESTAMP(3),
ADD COLUMN "lastBackfillAt" TIMESTAMP(3),
ADD COLUMN "lastTaggingAt" TIMESTAMP(3),
ADD COLUMN "taggingDryRun" BOOLEAN DEFAULT true;
