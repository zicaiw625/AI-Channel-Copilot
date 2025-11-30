-- CreateEnum
CREATE TYPE "AiSource" AS ENUM ('ChatGPT', 'Perplexity', 'Gemini', 'Copilot', 'Other_AI');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('queued', 'processing', 'completed', 'failed');

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'shopify',
    "acquiredViaAi" BOOLEAN NOT NULL DEFAULT false,
    "firstOrderId" TEXT,
    "firstOrderAt" TIMESTAMP(3),
    "lastOrderAt" TIMESTAMP(3),
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "totalSpent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "firstAiOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'shopify',
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "totalPrice" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "subtotalPrice" DOUBLE PRECISION,
    "refundTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "aiSource" "AiSource",
    "detection" TEXT,
    "detectionSignals" JSONB,
    "referrer" TEXT,
    "landingPage" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "sourceName" TEXT,
    "customerId" TEXT,
    "isNewCustomer" BOOLEAN NOT NULL DEFAULT false,
    "createdAtLocal" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderProduct" (
    "id" SERIAL NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "handle" TEXT,
    "url" TEXT,
    "price" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "OrderProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopSettings" (
    "id" SERIAL NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'shopify',
    "primaryCurrency" TEXT NOT NULL DEFAULT 'USD',
    "aiDomains" JSONB NOT NULL,
    "utmSources" JSONB NOT NULL,
    "utmMediumKeywords" JSONB NOT NULL,
    "orderTagPrefix" TEXT NOT NULL,
    "customerTag" TEXT NOT NULL,
    "writeOrderTags" BOOLEAN NOT NULL DEFAULT false,
    "writeCustomerTags" BOOLEAN NOT NULL DEFAULT false,
    "taggingDryRun" BOOLEAN NOT NULL DEFAULT true,
    "language" TEXT NOT NULL DEFAULT '中文',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "gmvMetric" TEXT NOT NULL DEFAULT 'current_total_price',
    "pipelineStatuses" JSONB,
    "aiExposurePreferences" JSONB,
    "retentionMonths" INTEGER NOT NULL DEFAULT 6,
    "lastOrdersWebhookAt" TIMESTAMP(3),
    "lastCleanupAt" TIMESTAMP(3),
    "lastBackfillAt" TIMESTAMP(3),
    "lastTaggingAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookJob" (
    "id" SERIAL NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "externalId" TEXT,
    "orderId" TEXT,
    "eventTime" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextRunAt" TIMESTAMP(3),
    "status" "JobStatus" NOT NULL DEFAULT 'queued',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "WebhookJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackfillJob" (
    "id" SERIAL NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "range" TEXT NOT NULL,
    "rangeStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rangeEnd" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "maxOrders" INTEGER,
    "maxDurationMs" INTEGER,
    "status" "JobStatus" NOT NULL DEFAULT 'queued',
    "ordersFetched" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "BackfillJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Customer_shopDomain_idx" ON "Customer"("shopDomain");

-- CreateIndex
CREATE INDEX "Customer_shopDomain_platform_idx" ON "Customer"("shopDomain", "platform");

-- CreateIndex
CREATE INDEX "Order_shopDomain_createdAt_idx" ON "Order"("shopDomain", "createdAt");

-- CreateIndex
CREATE INDEX "Order_shopDomain_platform_createdAt_idx" ON "Order"("shopDomain", "platform", "createdAt");

-- CreateIndex
CREATE INDEX "Order_shopDomain_aiSource_idx" ON "Order"("shopDomain", "aiSource");

-- CreateIndex
CREATE INDEX "Order_shopDomain_platform_idx" ON "Order"("shopDomain", "platform");

-- CreateIndex
CREATE INDEX "orders_shop_date_desc" ON "Order"("shopDomain", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "orders_shop_ai_desc" ON "Order"("shopDomain", "aiSource", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "orders_ai_id" ON "Order"("aiSource", "id");

-- CreateIndex
CREATE INDEX "OrderProduct_orderId_idx" ON "OrderProduct"("orderId");

-- CreateIndex
CREATE INDEX "OrderProduct_productId_idx" ON "OrderProduct"("productId");

-- CreateIndex
CREATE INDEX "ShopSettings_shopDomain_platform_idx" ON "ShopSettings"("shopDomain", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "shopDomain_platform" ON "ShopSettings"("shopDomain", "platform");

-- CreateIndex
CREATE INDEX "WebhookJob_shopDomain_idx" ON "WebhookJob"("shopDomain");

-- CreateIndex
CREATE INDEX "WebhookJob_status_idx" ON "WebhookJob"("status");

-- CreateIndex
CREATE INDEX "WebhookJob_shopDomain_topic_orderId_idx" ON "WebhookJob"("shopDomain", "topic", "orderId");

-- CreateIndex
CREATE INDEX "WebhookJob_status_nextRunAt_idx" ON "WebhookJob"("status", "nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_unique_external" ON "WebhookJob"("shopDomain", "topic", "externalId");

-- CreateIndex
CREATE INDEX "BackfillJob_shopDomain_idx" ON "BackfillJob"("shopDomain");

-- CreateIndex
CREATE INDEX "BackfillJob_status_idx" ON "BackfillJob"("status");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderProduct" ADD CONSTRAINT "OrderProduct_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

