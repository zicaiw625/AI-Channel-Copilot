-- 性能优化索引
-- 这些索引旨在优化最常见的查询模式

-- 优化 AI 订单查询 (Copilot 和 Dashboard)
CREATE INDEX IF NOT EXISTS "idx_orders_shop_ai_created" 
ON "Order" ("shopDomain", "aiSource", "createdAt" DESC) 
WHERE "aiSource" IS NOT NULL;

-- 优化产品聚合查询
CREATE INDEX IF NOT EXISTS "idx_order_products_product_order" 
ON "OrderProduct" ("productId", "orderId");

-- 优化客户 LTV 查询
CREATE INDEX IF NOT EXISTS "idx_orders_customer_shop_total" 
ON "Order" ("customerId", "shopDomain", "totalPrice" DESC) 
WHERE "customerId" IS NOT NULL;

-- 优化客户订单数查询
CREATE INDEX IF NOT EXISTS "idx_orders_customer_created" 
ON "Order" ("customerId", "createdAt") 
WHERE "customerId" IS NOT NULL;

-- 优化 Webhook 队列处理
CREATE INDEX IF NOT EXISTS "idx_webhook_jobs_shop_status_next" 
ON "WebhookJob" ("shopDomain", "status", "nextRunAt") 
WHERE "status" IN ('queued', 'processing');

-- 优化 AI 源和日期范围的复合查询
CREATE INDEX IF NOT EXISTS "idx_orders_shop_currency_created" 
ON "Order" ("shopDomain", "currency", "createdAt" DESC);

-- 优化新客户统计
CREATE INDEX IF NOT EXISTS "idx_orders_new_customer_flag" 
ON "Order" ("shopDomain", "isNewCustomer", "aiSource") 
WHERE "isNewCustomer" = true;

-- 添加部分索引以节省空间和提升性能
CREATE INDEX IF NOT EXISTS "idx_orders_ai_only" 
ON "Order" ("id", "shopDomain", "createdAt", "totalPrice", "aiSource") 
WHERE "aiSource" IS NOT NULL;

