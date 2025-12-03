# Session & Authentication 修复说明

**日期**: 2025-12-03  
**问题**: 首页按钮点击无反应，页面突然跳转到登录页

## 问题根因

### 错误日志分析
```
Missing access token when creating GraphQL client
at detectAndPersistDevShop
```

### 核心问题
1. **Session/Access Token 失效**: Shopify Embedded App 在某些情况下会返回一个存在但 access token 为空/无效的 admin 对象
2. **不安全的错误处理**: 多个路由在 authentication 失败后继续使用可能无效的 admin 客户端
3. **缺少缓存机制**: `detectAndPersistDevShop` 每次都尝试调用 Shopify API，即使 token 无效

## 修复内容

### 1. 增强 `detectAndPersistDevShop` 函数 (`app/lib/billing.server.ts`)

**改进点**:
- ✅ 添加 24 小时缓存机制，避免频繁 API 调用
- ✅ 使用 try-catch 包裹 GraphQL 调用，优雅处理 token 失效
- ✅ Token 失效时返回缓存值而不是崩溃

```typescript
// 关键改动
if (existing?.lastCheckedAt && existing.isDevShop !== undefined) {
  const hoursSinceCheck = (Date.now() - existing.lastCheckedAt.getTime()) / (1000 * 60 * 60);
  if (hoursSinceCheck < 24) {
    return existing.isDevShop; // 使用缓存，避免不必要的 API 调用
  }
}

try {
  response = await sdk.request("shopPlan", query, {});
} catch (error) {
  logger.warn("detectAndPersistDevShop GraphQL failed, using cached value", {...});
  return existing?.isDevShop ?? false; // 失败时回退到缓存
}
```

### 2. 修复所有路由的 Authentication 处理

修改的文件：
- ✅ `app/routes/app.tsx`
- ✅ `app/routes/app._index.tsx` (Dashboard)
- ✅ `app/routes/app.copilot.tsx`
- ✅ `app/routes/app.onboarding.tsx`
- ✅ `app/routes/app.billing.tsx`
- ✅ `app/routes/app.additional.tsx` (Settings)

**统一的修复模式**:

```typescript
// 之前（不安全）
try {
  const auth = await authenticate.admin(request);
  admin = auth.admin;
  session = auth.session;
} catch (e) {
  if (!demo) throw e;
}

// 之后立即使用 admin，可能导致问题
if (admin && shopDomain) {
  settings = await syncShopPreferences(admin, shopDomain, settings);
  await detectAndPersistDevShop(admin, shopDomain);
}
```

```typescript
// 修复后（安全）
let authFailed = false;
try {
  const auth = await authenticate.admin(request);
  admin = auth.admin;
  session = auth.session;
} catch (e) {
  authFailed = true; // 标记认证失败
  if (!demo) throw e;
}

// 只在认证成功时使用 admin
if (admin && shopDomain && !authFailed) {
  try {
    settings = await syncShopPreferences(admin, shopDomain, settings);
    await detectAndPersistDevShop(admin, shopDomain);
  } catch (e) {
    // 即使这些操作失败，也继续使用缓存数据
    console.warn("Admin operations failed:", (e as Error).message);
  }
}
```

### 3. 改进 Copilot 路由的错误处理 (`app/routes/app.copilot.tsx`)

**改进**:
- ✅ Authentication 失败时重定向到 `/app` 而不是抛出异常
- ✅ 避免用户看到空白的登录页

```typescript
try {
  const auth = await authenticate.admin(request);
  session = auth.session;
} catch (error) {
  if (!demo) {
    // 重定向到 app 首页，由统一的流程处理
    throw new Response(null, { 
      status: 302, 
      headers: { Location: "/app" } 
    });
  }
}
```

### 4. 保留历史数据（之前已修复）

**相关文件**: `app/routes/webhooks.app.uninstalled.tsx`

确保卸载时：
- ✅ 标记 billing 状态为 CANCELLED
- ✅ 清理 Session（强制重新认证）
- ✅ **保留**订单、客户等业务数据（用于重装恢复）

## 预期效果

修复后的行为：

1. **首次访问** (`/app`):
   - 正常认证 → 显示 Dashboard
   - Token 失效 → 使用缓存数据，不崩溃

2. **点击 Copilot**:
   - 有效 Session → 正常显示 Copilot 页面
   - 无效 Session → 重定向到 `/app`，由统一流程处理

3. **API 调用失败**:
   - 使用 24 小时内的缓存数据
   - 记录 warning 日志但不影响用户体验

## 测试建议

1. **正常流程**:
   ```bash
   # 从 Shopify Admin 进入 App
   # 点击各个导航链接（Dashboard, Copilot, Settings, Billing）
   # 验证页面正常加载，无重定向到登录页
   ```

2. **Session 失效场景**:
   ```bash
   # 清除浏览器 cookies
   # 或等待 Session 过期（默认 1 小时）
   # 重新访问 App
   # 应该能正常重新认证，而不是崩溃
   ```

3. **监控日志**:
   ```bash
   # 检查是否还有 "Missing access token" 错误
   # 应该看到 "using cached value" 的 warning（正常降级）
   ```

## 相关设计文档

- 设计方案 v0.1: `/docs/trial-billing-design.md` (本次审查的设计文档)
- Queue 设计: `/docs/queue-design.md`

## 后续优化建议

1. **Session 管理增强**:
   - 考虑实现 Token Refresh 机制
   - 增加 Session 过期前的主动刷新

2. **监控告警**:
   - 监控 "detectAndPersistDevShop" 失败率
   - 如果持续失败，说明 Shopify API 有问题

3. **用户体验**:
   - 在 Token 即将过期时显示提示
   - 提供"重新连接"按钮

