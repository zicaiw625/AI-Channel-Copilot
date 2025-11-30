import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.hero}>
        <div className={styles.badge}>AI Discovery & Attribution Copilot · v0.1</div>
        <h1 className={styles.heading}>
          发现被忽略的 AI 渠道 GMV，基于 Shopify 订单的保守归因
        </h1>
        <p className={styles.text}>
          自动识别来自 ChatGPT / Perplexity / Gemini / Copilot 的订单，提供基础仪表盘、调试视图、规则配置与
          CSV 导出，帮助中高阶 DTC 商家判断 AI 渠道是否值得投入。
        </p>
        <div className={styles.actions}>
          {showForm && (
            <Form className={styles.form} method="post" action="/auth/login">
              <label className={styles.label}>
                <span>Shop domain</span>
                <input
                  className={styles.input}
                  type="text"
                  name="shop"
                  placeholder="your-store.myshopify.com"
                />
              </label>
              <button className={styles.button} type="submit">
                登录 Shopify 店铺
              </button>
            </Form>
          )}
          <div className={styles.chips}>
            <span>Referrer + UTM 保守识别</span>
            <span>AI 渠道 GMV / 订单 / 新客</span>
            <span>Top Products from AI Channels</span>
            <span>标签写回 & CSV 导出</span>
          </div>
        </div>
      </div>

      <div className={styles.panel}>
        <div className={styles.panelSection}>
          <h3>v0.1 功能覆盖</h3>
          <ul>
            <li>数据接入：Shopify Admin API + orders/create webhook + 90 天补拉。</li>
            <li>AI 渠道识别：预置 ChatGPT / Perplexity / Gemini / Copilot 域名 & UTM。</li>
            <li>基础仪表盘：GMV、订单、新客、AOV、复购，对比 AI vs Overall。</li>
            <li>调试视图：最近订单的 referrer / UTM / 解析结果，便于核验规则。</li>
            <li>设置 & 导出：域名/UTM 规则、标签写回、语言时区、订单/产品 CSV。</li>
          </ul>
        </div>
        <div className={styles.panelSection}>
          <h3>适合谁？</h3>
          <p>
            年 GMV 20万-500万美金的 DTC 品牌主 / 增长负责人 / 数据分析师，希望量化 AI 助手带来的真实 GMV 与
            客单表现。
          </p>
          <div className={styles.statsRow}>
            <div>
              <div className={styles.statLabel}>AI 新客占比</div>
              <div className={styles.statValue}>30-45%</div>
            </div>
            <div>
              <div className={styles.statLabel}>AI AOV 对比</div>
              <div className={styles.statValue}>+15-30%</div>
            </div>
            <div>
              <div className={styles.statLabel}>识别口径</div>
              <div className={styles.statValue}>保守估计</div>
            </div>
          </div>
        </div>
        <div className={styles.panelSection}>
          <h3>快速上手（安装后即可看到基础数据）</h3>
          <ol>
            <li>安装 Shopify 应用并授权，后台会自动补拉最近 90 天订单。</li>
            <li>
              Dashboard 查看 AI GMV / 订单 / 新客，默认规则已覆盖 chat.openai.com、perplexity.ai、
              gemini.google.com、copilot.microsoft.com 与 utm_source=chatgpt/perplexity/gemini/copilot。
            </li>
            <li>在 Settings 调整识别规则、开启标签写回（默认关闭）并下载 CSV 导出。</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
