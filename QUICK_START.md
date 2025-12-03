# ⚡ 快速开始 - 优化实施

这是一个快速参考指南，帮助你立即开始使用新的优化模块。

---

## 🚀 5分钟快速集成

### 1. 数据库索引 (⏱️ 2分钟)

```bash
# 运行迁移
npx prisma migrate deploy

# 验证索引
psql $DATABASE_URL -c "\di+ idx_orders_*"
```

### 2. 启用缓存 (⏱️ 1分钟)

```typescript
// 在任何查询函数中
import { cache, CacheKeys, CacheTTL } from '~/lib/cache.enhanced';

const data = await cache.getOrSet(
  CacheKeys.dashboard(shopDomain, '30d'),
  async () => {
    // 你的原有查询逻辑
    return await fetchData();
  },
  CacheTTL.MEDIUM
);
```

### 3. 添加输入验证 (⏱️ 1分钟)

```typescript
// API 路由顶部
import { CopilotRequestSchema } from '~/lib/validation/schemas';

export const action = async ({ request }) => {
  const body = await request.json();
  const validated = CopilotRequestSchema.parse(body); // 自动验证
  // 继续处理...
};
```

### 4. 添加速率限制 (⏱️ 1分钟)

```typescript
import { enforceRateLimit, RateLimitRules } from '~/lib/security/rateLimit.server';

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  await enforceRateLimit(session.shop, RateLimitRules.API_DEFAULT);
  // 继续处理...
};
```

---

## 📖 常用代码片段

### 缓存模式

```typescript
// 模式 1: 简单缓存
const settings = cache.get<Settings>(CacheKeys.settings(shop));

// 模式 2: 获取或设置
const data = await cache.getOrSet(key, fetcher, ttl);

// 模式 3: 清除模式匹配的缓存
cache.deletePattern(`dashboard:${shop}:*`);
```

### 验证模式

```typescript
// 验证并捕获错误
try {
  const data = MySchema.parse(input);
} catch (error) {
  if (error instanceof z.ZodError) {
    return json({ errors: error.errors }, { status: 400 });
  }
}

// 安全解析
const result = MySchema.safeParse(input);
if (!result.success) {
  return json({ errors: result.error }, { status: 400 });
}
```

### 指标收集

```typescript
// 计数器
metrics.increment('order.created', 1, { source: 'webhook' });

// 计时器
const timer = metrics.startTimer('query.execution');
// ... 执行操作
metrics.endTimer(timer);

// 或使用包装器
await withMetrics('operation', async () => {
  // 你的操作
}, { tag: 'value' });
```

### Repository 使用

```typescript
import { ordersRepository } from '~/lib/repositories/orders.repository';

// 查询订单
const orders = await ordersRepository.findByShopAndDateRange(
  shopDomain,
  range,
  { aiOnly: true, limit: 100 }
);

// 聚合统计
const stats = await ordersRepository.getAggregateStats(shopDomain, range);
```

### Service 使用

```typescript
import { dashboardService } from '~/lib/services/dashboard.service';

// 获取仪表盘数据
const data = await dashboardService.getDashboardData(
  shopDomain,
  range,
  { useCache: true, timezone: 'UTC' }
);

// 只获取概览
const overview = await dashboardService.getOverview(shopDomain, range);
```

---

## 🎯 核心 API 参考

### Cache API

```typescript
cache.get<T>(key: string): T | null
cache.set<T>(key: string, data: T, ttlMs?: number): void
cache.delete(key: string): boolean
cache.deletePattern(pattern: string): number
cache.getStats(): CacheStats
```

### Validation API

```typescript
// 已定义的 Schema
CopilotRequestSchema
DashboardQuerySchema
ShopifyOrderWebhookSchema
SettingsUpdateSchema
SubscriptionRequestSchema
```

### Rate Limit API

```typescript
enforceRateLimit(identifier: string, rule: RateLimitRule): Promise<void>
getRateLimitHeaders(identifier: string, rule: RateLimitRule): Promise<Headers>

// 预定义规则
RateLimitRules.API_DEFAULT    // 60 req/min
RateLimitRules.COPILOT        // 20 req/min
RateLimitRules.DASHBOARD      // 30 req/min
RateLimitRules.EXPORT         // 5 req/5min
```

### Metrics API

```typescript
metrics.increment(name: string, value?: number, tags?: Tags)
metrics.gauge(name: string, value: number, tags?: Tags)
metrics.timing(name: string, durationMs: number, tags?: Tags)
metrics.histogram(name: string, value: number, tags?: Tags)
```

---

## 🔍 调试和监控

### 查看缓存状态

```typescript
import { cache } from '~/lib/cache.enhanced';
console.log(cache.getStats());
// { total: 50, active: 45, expired: 5, maxSize: 1000 }
```

### 查看指标

```typescript
import { metrics } from '~/lib/metrics/collector';
console.log(metrics.getAggregated());
```

### 查看 Rate Limit 状态

```typescript
import { rateLimiter } from '~/lib/security/rateLimit.server';
const stats = rateLimiter.getStats(identifier, windowMs);
```

---

## ⚠️ 常见陷阱

### ❌ 错误做法

```typescript
// 1. 直接使用未验证的输入
const { range } = await request.json(); // 危险！

// 2. 忘记清除缓存
await updateOrder(...);
// 应该: cache.deletePattern(`dashboard:${shop}:*`);

// 3. 没有速率限制保护
export const action = async ({ request }) => {
  // 直接处理，容易被滥用
};
```

### ✅ 正确做法

```typescript
// 1. 验证输入
const body = MySchema.parse(await request.json());

// 2. 更新后清除缓存
await updateOrder(...);
cache.deletePattern(`dashboard:${shop}:*`);

// 3. 添加速率限制
export const action = async ({ request }) => {
  await enforceRateLimit(getIdentifier(request), rule);
  // 继续处理
};
```

---

## 📦 推荐的集成顺序

1. **Week 1**: 数据库索引 + 缓存系统
2. **Week 2**: 输入验证 + 速率限制
3. **Week 3**: Repository + Service 层
4. **Week 4**: 指标收集 + 监控

---

## 🆘 获取帮助

- **详细文档**: 查看 `docs/optimization-implementation-guide.md`
- **完整审查**: 查看 `docs/optimization-review-2025-12-03.md`
- **优化总结**: 查看 `OPTIMIZATION_SUMMARY.md`
- **测试示例**: 查看 `tests/services/dashboard.service.test.ts`

---

## ✅ 验收清单

在认为集成完成之前，确保:

- [ ] 数据库迁移已运行且索引已创建
- [ ] 至少一个路由使用了缓存
- [ ] 至少一个 API 端点有输入验证
- [ ] 至少一个端点有速率限制保护
- [ ] 所有测试通过
- [ ] TypeScript 编译无错误
- [ ] Dashboard 加载速度有可见提升

---

**开始时间**: _____________________  
**完成时间**: _____________________  
**遇到的问题**: _____________________

祝集成顺利！🎉

