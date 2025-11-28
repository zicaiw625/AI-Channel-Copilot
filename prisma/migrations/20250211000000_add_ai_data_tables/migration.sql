-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopDomain" TEXT NOT NULL,
    "acquiredViaAi" BOOLEAN NOT NULL DEFAULT false,
    "firstOrderAt" DATETIME,
    "lastOrderAt" DATETIME,
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "totalSpent" REAL NOT NULL DEFAULT 0,
    "firstAiOrderId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopDomain" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "totalPrice" REAL NOT NULL,
    "subtotalPrice" REAL,
    "aiSource" TEXT,
    "detection" TEXT,
    "referrer" TEXT,
    "landingPage" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "sourceName" TEXT,
    "customerId" TEXT,
    "isNewCustomer" BOOLEAN NOT NULL DEFAULT false,
    "createdAtLocal" DATETIME,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Order_aiSource_check" CHECK ("aiSource" IN ('ChatGPT', 'Perplexity', 'Gemini', 'Copilot', 'Other_AI')),
    CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrderProduct" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "handle" TEXT,
    "url" TEXT,
    "price" REAL NOT NULL,
    "quantity" INTEGER NOT NULL,
    CONSTRAINT "OrderProduct_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ShopSettings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shopDomain" TEXT NOT NULL,
    "aiDomains" JSON NOT NULL,
    "utmSources" JSON NOT NULL,
    "utmMediumKeywords" JSON NOT NULL,
    "orderTagPrefix" TEXT NOT NULL,
    "customerTag" TEXT NOT NULL,
    "writeOrderTags" BOOLEAN NOT NULL DEFAULT false,
    "writeCustomerTags" BOOLEAN NOT NULL DEFAULT false,
    "language" TEXT NOT NULL DEFAULT '中文',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "gmvMetric" TEXT NOT NULL DEFAULT 'current_total_price',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "Customer_shopDomain_idx" ON "Customer"("shopDomain");

-- CreateIndex
CREATE INDEX "Order_shopDomain_createdAt_idx" ON "Order"("shopDomain", "createdAt");

-- CreateIndex
CREATE INDEX "Order_shopDomain_aiSource_idx" ON "Order"("shopDomain", "aiSource");

-- CreateIndex
CREATE INDEX "OrderProduct_orderId_idx" ON "OrderProduct"("orderId");

-- CreateIndex
CREATE INDEX "OrderProduct_productId_idx" ON "OrderProduct"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ShopSettings_shopDomain_key" ON "ShopSettings"("shopDomain");
