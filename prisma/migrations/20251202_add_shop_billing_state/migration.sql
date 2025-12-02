-- CreateTable ShopBillingState for billing observability
CREATE TABLE IF NOT EXISTS "ShopBillingState" (
  "id" SERIAL PRIMARY KEY,
  "shopDomain" TEXT NOT NULL,
  "platform" TEXT NOT NULL DEFAULT 'shopify',
  "isDevShop" BOOLEAN NOT NULL DEFAULT false,
  "hasEverSubscribed" BOOLEAN NOT NULL DEFAULT false,
  "lastSubscriptionStatus" TEXT,
  "lastTrialStartAt" TIMESTAMP(3),
  "lastTrialEndAt" TIMESTAMP(3),
  "lastCheckedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS "ShopBillingState_shopDomain_idx" ON "ShopBillingState" ("shopDomain");
CREATE UNIQUE INDEX IF NOT EXISTS "billing_shop_platform" ON "ShopBillingState" ("shopDomain", "platform");

