-- 添加 backfill 尝试追踪字段
-- 用于区分"任务完成时间"和"拉到订单时间"，解决 0 单店铺无限触发 backfill 的问题

-- 最后一次 backfill 尝试完成的时间（无论是否有订单）
ALTER TABLE "ShopSettings" ADD COLUMN IF NOT EXISTS "lastBackfillAttemptAt" TIMESTAMP(3);

-- 最后一次 backfill 拉取到的订单数
ALTER TABLE "ShopSettings" ADD COLUMN IF NOT EXISTS "lastBackfillOrdersFetched" INTEGER;
