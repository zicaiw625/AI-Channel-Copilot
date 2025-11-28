-- AlterTable
ALTER TABLE "ShopSettings"
ADD COLUMN "pipelineStatuses" JSON,
ADD COLUMN "lastOrdersWebhookAt" DATETIME,
ADD COLUMN "lastBackfillAt" DATETIME,
ADD COLUMN "lastTaggingAt" DATETIME,
ADD COLUMN "taggingDryRun" BOOLEAN DEFAULT true;
