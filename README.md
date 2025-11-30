# AI Discovery & Attribution Copilot

AI Discovery & Attribution Copilot 帮助 Shopify 商家识别来自 ChatGPT、Perplexity、Gemini、Copilot 等 AI 助手带来的真实 GMV。应用默认以保守口径统计“站外 AI 点击 → 到站 → 完成订单”的链路，并提供仪表盘、调试视图、标签写回与 CSV 导出。

## 适合谁
- 年 GMV 20-500 万美金、想评估 AI 助手带来 GMV/客单/新客表现的 DTC 品牌。
- 需要验证“AI 流量是否值得持续投入”的增长负责人、数据分析师。

## 功能概览（v0.1）
- 数据接入：Shopify Admin API + orders/create webhook + 90 天补拉，自动更新。
- AI 渠道识别：预置 referrer + UTM 规则，支持自定义域名/utm_source/utm_medium。
- 仪表盘：AI GMV / 订单 / 新客、AOV、复购率，对比 Overall 与各渠道；展示数据更新时间与管道状态。
- 调试视图：最近订单的 referrer / UTM / 解析结果，便于核验规则。
- 写回与导出：可选的订单/客户标签写回，订单与产品榜单 CSV 导出。

## 默认识别规则（开箱即用）
- **Referrer** 包含：`chat.openai.com`、`perplexity.ai`、`gemini.google.com`、`copilot.microsoft.com`。
- **utm_source**：`chatgpt`、`perplexity`、`gemini`、`copilot`（可在设置页扩展）。
- **提示**：部分 AI 会隐藏 referrer，结果为保守估计；仅统计站外 AI 点击到店并完成订单的链路。

## 安装与启动
1. 在 Shopify 后台安装应用并授权。安装后会自动补拉最近 90 天订单。*
2. 进入 **Dashboard** 查看 AI GMV/订单/新客，数据更新时间位于顶部 Meta 行。
3. 前往 **Settings**：根据需要调整域名/UTM 规则、开启标签写回（默认关闭，建议先在测试店验证）、下载 CSV 导出。

\* 若 30 分钟内已补拉过，界面会提示复用缓存以减轻 API 压力。

## 本地开发
1. 安装依赖：`npm install`。
2. 设置环境变量（建议使用 `.env`）：`SHOPIFY_API_KEY`、`SHOPIFY_API_SECRET`、`SCOPES`、`SHOPIFY_APP_URL`、`DATABASE_URL`。
3. 初始化数据库与客户端：`npm run setup`（运行 Prisma generate + migrate deploy）。
4. 启动开发服务：`npm run dev`（依赖 Shopify CLI 提供的隧道与配置）。

## 部署提示
- 生产环境需提供持久化 Postgres 并设置 `DATABASE_URL`，部署后运行 `npm run setup` 确认表结构。
- 必填环境变量：`SHOPIFY_API_KEY`、`SHOPIFY_API_SECRET`、`SCOPES`、`SHOPIFY_APP_URL`、`DATABASE_URL`。
- Webhook 订阅定义在 `shopify.app.toml`，确保公网可达；关键路径报错会返回非 2xx 以便 Shopify 重试。

## 数据库加密与访问控制
- **磁盘加密**：生产数据库需启用存储加密（如云厂商的静态加密或自建卷 LUKS），确保落盘数据合规。
- **网络准入**：将数据库网络策略限制为仅应用服务的出口 IP（或私网安全组）可访问，禁止公共入口暴露；建议启用最小权限的数据库账户与定期轮换凭证。
- **应用内防护**：
  - 生产环境默认强制 `sslmode=require` / `ssl=true`，可通过 `DB_REQUIRE_SSL=false` 显式关闭（不建议）。
  - 如配置 `DB_ALLOWED_HOSTS`（逗号分隔），应用会在启动时校验 `DATABASE_URL` 的 host 是否在名单内，否则直接终止，避免连向未受控实例。
- **传输加密提示**：生产连接缺少 SSL 时会抛错，非生产会输出警告日志；请在基础设施层确保 TLS 与磁盘加密已开启并记录到变更审计。

## 安全与免责声明
- 标签写回默认关闭；启用后会修改 Shopify 订单/客户标签，若店铺存在基于标签的自动化流程，请先在测试店验证。
- AI 渠道识别基于 referrer/UTM/tag，无法覆盖隐藏来源或站内曝光，所有数值均为保守估计。

## 数据保留与清理
- 默认仅保留最近 **6 个月** 的订单/客户数据，可通过环境变量 `DATA_RETENTION_MONTHS` 或后台设置调整（最小值 1）。
- 仪表盘在有管理员访问时会自动触发每日一次的清理，将超出保留期的订单与孤立客户删除并记录 `lastCleanupAt`。
- 也可通过 `POST /api/retention` 手动触发清理（`?force=true` 可强制立即执行），用于回归/隐私审计场景。

## 自动化回归脚本
- 使用 `npm run regression` 在测试店自动造数与派发 webhook：脚本会读取 `SHOPIFY_STORE_DOMAIN`、`SHOPIFY_ADMIN_TOKEN`（GraphQL Admin）、`SHOPIFY_API_SECRET`（计算 HMAC，可选）并寻找首个可用商品变体作为下单货品。
- 每次运行会创建两笔测试订单（带不同的 `utm_source`/`utm_medium`），随后向 `orders/create` 与 `orders/updated` webhook 端点推送签名 payload 以驱动管道入库。
- 可通过环境变量 `APP_WEBHOOK_URL`、`APP_WEBHOOK_UPDATE_URL` 定位到实际应用的 webhook 地址，默认指向本地 `http://localhost:3000`；运行完成后在 Dashboard 调试视图与队列面板验证落库与解析结果。
## Render 部署

- 准备：将 `SHOPIFY_API_KEY`、`SHOPIFY_API_SECRET`、`SCOPES`、`SHOPIFY_APP_URL`、`DATABASE_URL` 配置到 Render；仓库已包含 `render.yaml`（Blueprints）。
- 步骤：
  - 在 Render 点击 New → Blueprints → 选择本仓库 → main 分支 → 自动识别 `render.yaml`。
  - 创建 Web Service 与 PostgreSQL 数据库，填写 `SHOPIFY_API_KEY/SHOPIFY_API_SECRET/SHOPIFY_APP_URL`。
  - 部署完成后，将 Render 域名填入 Shopify Partners 的 App URL 与回调地址。
- 构建/启动：
  - Build：`npm run setup && npm run build`
  - Start：`npm run start`
- 健康检查：`GET /`

### 环境变量说明
- `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET`：从 Shopify Partners 获取
- `SHOPIFY_APP_URL`：Render 站点完整 HTTPS URL
- `SCOPES`：例如 `read_orders,read_customers,read_products,write_orders,write_customers`
- `DATABASE_URL`：由 Render 数据库自动注入
- 可选：`DEFAULT_RANGE_KEY=30d`、`MAX_BACKFILL_ORDERS=1000`、`MAX_BACKFILL_DAYS=90`、`MAX_BACKFILL_DURATION_MS=5000`、`BACKFILL_TAGGING_BATCH_SIZE=25`、`DATA_RETENTION_MONTHS=6`

