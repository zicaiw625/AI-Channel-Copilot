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

## 安全与免责声明
- 标签写回默认关闭；启用后会修改 Shopify 订单/客户标签，若店铺存在基于标签的自动化流程，请先在测试店验证。
- AI 渠道识别基于 referrer/UTM/tag，无法覆盖隐藏来源或站内曝光，所有数值均为保守估计。

