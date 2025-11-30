-- CreateEnum
CREATE TYPE "AiSource" AS ENUM ('ChatGPT', 'Perplexity', 'Gemini', 'Copilot', 'Other_AI');

-- DropIndex
DROP INDEX "ShopSettings_shopDomain_key";

-- AlterTable
ALTER TABLE "Customer" ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "platform" SET NOT NULL;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "refundTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
DROP COLUMN "aiSource",
ADD COLUMN     "aiSource" "AiSource",
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "platform" SET NOT NULL,
ALTER COLUMN "currency" SET NOT NULL;

-- AlterTable
ALTER TABLE "OrderProduct" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'USD';

-- AlterTable
ALTER TABLE "ShopSettings" ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "taggingDryRun" SET NOT NULL,
ALTER COLUMN "platform" SET NOT NULL;

-- AlterTable
ALTER TABLE "WebhookJob" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "eventTime" TIMESTAMP(3),
ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "nextRunAt" TIMESTAMP(3),
ADD COLUMN     "orderId" TEXT;

-- CreateIndex
CREATE INDEX "Order_shopDomain_platform_createdAt_idx" ON "Order"("shopDomain", "platform", "createdAt");

-- CreateIndex
CREATE INDEX "Order_shopDomain_aiSource_idx" ON "Order"("shopDomain", "aiSource");

-- CreateIndex
CREATE INDEX "orders_shop_date_desc" ON "Order"("shopDomain", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "orders_shop_ai_desc" ON "Order"("shopDomain", "aiSource", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "orders_ai_id" ON "Order"("aiSource", "id");

-- CreateIndex
CREATE INDEX "WebhookJob_shopDomain_topic_orderId_idx" ON "WebhookJob"("shopDomain", "topic", "orderId");

-- CreateIndex
CREATE INDEX "WebhookJob_status_nextRunAt_idx" ON "WebhookJob"("status", "nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_unique_external" ON "WebhookJob"("shopDomain", "topic", "externalId");

