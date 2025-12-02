# Webhook 队列处理设计说明

## 目标

- 保障多实例部署下的幂等与互斥
- 优先保证「按店铺」的有序处理，避免不同店铺间相互阻塞
- 提供失败重试与死信查看能力

## 设计要点

- 队列模型：`webhookJob` 表，状态机包含 `queued`/`processing`/`completed`/`failed`
- 互斥锁：基于数据库 advisory lock，按 `shopDomain` 生成锁键，确保同一店铺在任一时刻仅一个消费者处理
- 处理粒度：
  - 全局：不提供单一全局处理循环，避免单店长事务拖累其它店铺
  - 按店铺：`processWebhookQueueForShop(shopDomain, handlers)` 拉取并处理该店铺队列
- 重试策略：指数退避 + 抖动，最多 `WEBHOOK_MAX_RETRIES`
- 去重策略：按 `externalId` 或 `orderId` 消除重复入队

## 为什么不使用“全局队列循环”

- 多租户隔离：全局循环在高峰期容易形成“长尾阻塞”，导致无关店铺的任务被延迟
- 可用性：实例级故障不会影响其它实例按店铺自恢复；全局循环更易产生单点瓶颈
- 可观察性：按店铺统计队列长度与失败率更容易定位问题与动态扩缩

## 如需全局队列

- 可以在应用层实现“调度入口”，周期遍历所有 `shopDomain` 并调用 `processWebhookQueueForShop`
- 或者引入独立队列服务（如 Kafka/Redis Stream）进行跨实例协调，但需补充多租户限流与隔离

## 相关代码

- `app/lib/webhookQueue.server.ts`: 队列入队、去重、失败重试、按店铺处理
- `app/lib/scheduler.server.ts`: 定时任务入口，示例触发 Backfill 与日清理

