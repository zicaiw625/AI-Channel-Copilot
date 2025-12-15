-- 🔧 迁移脚本：添加 lineItemId 字段修复 OrderProduct 丢行/覆盖问题
-- 
-- 问题描述：
-- 原先使用 productId 作为行项目标识，导致同一订单中同一产品的多个 variant 会互相覆盖
-- 
-- 解决方案：
-- 1. 添加 lineItemId 字段（Shopify LineItem GID）
-- 2. 为现有数据生成临时 lineItemId（基于 id 字段）
-- 3. 添加唯一约束 (orderId, lineItemId)

-- Step 1: 添加 lineItemId 列（允许为空，方便迁移）
ALTER TABLE "OrderProduct" ADD COLUMN "lineItemId" TEXT;

-- Step 2: 为现有记录填充 lineItemId（使用 id 作为临时值，保证唯一性）
-- 格式: legacy:{id} 以区分新旧数据
UPDATE "OrderProduct" 
SET "lineItemId" = 'legacy:' || "id"::text
WHERE "lineItemId" IS NULL;

-- Step 3: 设置 NOT NULL 约束
ALTER TABLE "OrderProduct" ALTER COLUMN "lineItemId" SET NOT NULL;

-- Step 4: 创建唯一约束索引
CREATE UNIQUE INDEX "order_line_item_unique" ON "OrderProduct"("orderId", "lineItemId");

