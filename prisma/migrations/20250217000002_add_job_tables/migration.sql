-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('queued', 'processing', 'completed', 'failed');

-- CreateTable
CREATE TABLE "WebhookJob" (
    "id" SERIAL PRIMARY KEY,
    "shopDomain" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'queued',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3)
);

-- CreateTable
CREATE TABLE "BackfillJob" (
    "id" SERIAL PRIMARY KEY,
    "shopDomain" TEXT NOT NULL,
    "range" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'queued',
    "ordersFetched" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3)
);

-- Indexes
CREATE INDEX "WebhookJob_shopDomain_idx" ON "WebhookJob"("shopDomain");
CREATE INDEX "WebhookJob_status_idx" ON "WebhookJob"("status");
CREATE INDEX "BackfillJob_shopDomain_idx" ON "BackfillJob"("shopDomain");
CREATE INDEX "BackfillJob_status_idx" ON "BackfillJob"("status");
