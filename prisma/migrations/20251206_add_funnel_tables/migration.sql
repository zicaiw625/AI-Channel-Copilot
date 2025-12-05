-- 漏斗归因扩展：添加 VisitorSession 和 Checkout 表
-- 支持更细粒度的漏斗分析：访问 → 加购 → 结账 → 成交

-- 访问/会话表：记录用户访问
CREATE TABLE IF NOT EXISTS "VisitorSession" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'shopify',
    
    -- 访问信息
    "visitorId" TEXT,
    "customerId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "landingPage" TEXT,
    "referrer" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    
    -- AI 归因
    "aiSource" TEXT,
    "detectionSignals" JSONB,
    
    -- 漏斗状态
    "hasAddToCart" BOOLEAN NOT NULL DEFAULT false,
    "hasCheckoutStarted" BOOLEAN NOT NULL DEFAULT false,
    "hasOrderCompleted" BOOLEAN NOT NULL DEFAULT false,
    
    -- 关联
    "checkoutId" TEXT,
    "orderId" TEXT,
    
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisitorSession_pkey" PRIMARY KEY ("id")
);

-- 结账表：记录结账流程
CREATE TABLE "Checkout" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'shopify',
    
    -- Shopify checkout 信息
    "token" TEXT,
    "cartToken" TEXT,
    "email" TEXT,
    "customerId" TEXT,
    
    -- 时间节点
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "abandonedAt" TIMESTAMP(3),
    
    -- 金额
    "totalPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "subtotalPrice" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    
    -- 归因信息
    "referrer" TEXT,
    "landingPage" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "aiSource" TEXT,
    "detectionSignals" JSONB,
    
    -- 状态
    "status" TEXT NOT NULL DEFAULT 'open',
    
    -- 关联
    "orderId" TEXT,
    "lineItemsCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Checkout_pkey" PRIMARY KEY ("id")
);

-- 漏斗事件表：记录漏斗中的关键事件
CREATE TABLE "FunnelEvent" (
    "id" SERIAL NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'shopify',
    
    -- 事件类型: page_view, add_to_cart, checkout_started, checkout_completed, order_created
    "eventType" TEXT NOT NULL,
    "eventTime" TIMESTAMP(3) NOT NULL,
    
    -- 关联 ID
    "sessionId" TEXT,
    "checkoutId" TEXT,
    "orderId" TEXT,
    "customerId" TEXT,
    "productId" TEXT,
    
    -- 归因
    "aiSource" TEXT,
    "referrer" TEXT,
    "utmSource" TEXT,
    
    -- 元数据
    "metadata" JSONB,
    
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FunnelEvent_pkey" PRIMARY KEY ("id")
);

-- 添加索引
CREATE INDEX "VisitorSession_shopDomain_idx" ON "VisitorSession"("shopDomain");
CREATE INDEX "VisitorSession_shopDomain_platform_idx" ON "VisitorSession"("shopDomain", "platform");
CREATE INDEX "VisitorSession_shopDomain_startedAt_idx" ON "VisitorSession"("shopDomain", "startedAt");
CREATE INDEX "VisitorSession_aiSource_idx" ON "VisitorSession"("aiSource");
CREATE INDEX "VisitorSession_customerId_idx" ON "VisitorSession"("customerId");

CREATE INDEX "Checkout_shopDomain_idx" ON "Checkout"("shopDomain");
CREATE INDEX "Checkout_shopDomain_platform_idx" ON "Checkout"("shopDomain", "platform");
CREATE INDEX "Checkout_shopDomain_createdAt_idx" ON "Checkout"("shopDomain", "createdAt");
CREATE INDEX "Checkout_aiSource_idx" ON "Checkout"("aiSource");
CREATE INDEX "Checkout_status_idx" ON "Checkout"("status");
CREATE INDEX "Checkout_customerId_idx" ON "Checkout"("customerId");

CREATE INDEX "FunnelEvent_shopDomain_idx" ON "FunnelEvent"("shopDomain");
CREATE INDEX "FunnelEvent_shopDomain_eventType_idx" ON "FunnelEvent"("shopDomain", "eventType");
CREATE INDEX "FunnelEvent_shopDomain_eventTime_idx" ON "FunnelEvent"("shopDomain", "eventTime");
CREATE INDEX "FunnelEvent_aiSource_idx" ON "FunnelEvent"("aiSource");
CREATE INDEX "FunnelEvent_sessionId_idx" ON "FunnelEvent"("sessionId");
CREATE INDEX "FunnelEvent_checkoutId_idx" ON "FunnelEvent"("checkoutId");
