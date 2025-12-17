# AI Channel Copilot API 文档

本文档描述 AI Channel Copilot 应用的内部 API。

## 概述

AI Channel Copilot 是一个 Shopify 嵌入式应用，用于追踪和分析来自 AI 渠道（ChatGPT、Perplexity、Gemini、Copilot 等）的订单归因和 GMV 贡献。

## OpenAPI 规范

完整的 API 规范请参见 [openapi.yaml](./openapi.yaml)。

你可以使用以下工具查看交互式文档：
- [Swagger Editor](https://editor.swagger.io/)
- [Redoc](https://redocly.github.io/redoc/)
- VS Code 的 OpenAPI 扩展

## 认证

所有 API 端点都需要通过 Shopify OAuth 认证。这是 Shopify 嵌入式应用的标准认证流程。

## 速率限制

每个端点都有速率限制，以保护服务稳定性：

| 端点类型 | 限制 | 示例端点 |
|---------|------|---------|
| 轮询 (Polling) | 60 次/分钟 | `/api/jobs` |
| 标准 API | 60 次/分钟 | 大多数端点 |
| Copilot | 20 次/分钟 | `/api/copilot` |
| 导出 (Export) | 5 次/5分钟 | `/api/export/*` |
| 严格 (Strict) | 10 次/分钟 | `/api/backfill`, `/api/retention` |

### 响应头

超限时返回 HTTP 429，响应头包含：

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1702900000000
Retry-After: 45
```

## API 端点概览

### 数据查询

| 方法 | 端点 | 描述 |
|-----|------|------|
| POST | `/api/copilot` | AI Copilot 问答 |

### 数据导出

| 方法 | 端点 | 描述 | 计划要求 |
|-----|------|------|---------|
| GET | `/api/export/orders` | 导出订单 CSV | Pro+ |
| GET | `/api/export/products` | 导出产品 CSV | Pro+ |
| GET | `/api/export/customers` | 导出客户 CSV | Pro+ |
| GET | `/api/llms-txt-preview` | 预览 llms.txt | Pro+ |

### 后台任务

| 方法 | 端点 | 描述 |
|-----|------|------|
| GET | `/api/jobs` | 获取任务状态 |
| POST | `/api/backfill` | 触发数据回填 |
| POST | `/api/retention` | 触发数据清理 |

### Webhook 导出

| 方法 | 端点 | 描述 | 计划要求 |
|-----|------|------|---------|
| GET | `/api/webhook-export` | 获取 Webhook 配置 | Growth |
| POST | `/api/webhook-export` | 更新配置/触发导出 | Growth |

### App Proxy

| 方法 | 端点 | 描述 |
|-----|------|------|
| GET | `/proxy/llms` | 公开的 llms.txt 端点 |

## 错误处理

所有错误响应遵循统一格式：

```json
{
  "ok": false,
  "message": "错误描述",
  "error": "ERROR_CODE"
}
```

### 常见错误码

| HTTP 状态码 | 描述 |
|------------|------|
| 400 | 请求参数错误 |
| 401 | 未授权（需要登录） |
| 403 | 功能未授权（需要升级计划） |
| 429 | 请求频率超限 |
| 500 | 服务器内部错误 |

## 数据类型

### TimeRangeKey

时间范围选项：
- `7d` - 最近 7 天
- `30d` - 最近 30 天
- `90d` - 最近 90 天
- `custom` - 自定义范围（需要 `from` 和 `to` 参数）

### AISource

AI 渠道来源：
- `ChatGPT`
- `Perplexity`
- `Gemini`
- `Copilot`
- `Other-AI`

### CopilotIntent

Copilot 预定义意图：
- `overview` - 整体表现概览
- `comparison` - 渠道对比
- `trend` - 趋势分析
- `products` - 热销产品
- `customers` - 客户分析
- `growth` - 增长分析
- `channels` - 渠道细分

## 示例请求

### Copilot 问答

```bash
curl -X POST "https://your-store.myshopify.com/apps/ai-copilot/api/copilot" \
  -H "Content-Type: application/json" \
  -d '{
    "intent": "overview",
    "range": "30d"
  }'
```

### 导出订单

```bash
curl "https://your-store.myshopify.com/apps/ai-copilot/api/export/orders?range=30d" \
  -o ai-orders.csv
```

## 变更日志

### v1.0.0 (2024-12)
- 初始 API 版本
- 支持 Copilot 问答
- 支持数据导出
- 支持 Webhook 导出
- 实现分布式速率限制

