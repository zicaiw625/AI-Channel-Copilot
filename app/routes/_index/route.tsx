import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import styles from "../../styles/index.module.css";
import { readAppFlags, isProduction } from "../../lib/env.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  const language = url.searchParams.get("lang") === "en" ? "English" : "中文";
  // 生产环境强制隐藏表单，避免 Shopify 审核风险
  // Shopify 要求：应用不得在安装或配置流程中要求商家手动输入 myshopify.com 或店铺域名
  const showForm = !isProduction() && readAppFlags().enableLoginForm;
  return { showForm, language };
};

export default function App() {
  const { showForm, language } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.hero}>
        <div className={styles.badge}>{language === "English" ? "AI Discovery & Attribution Copilot · v0.1" : "AI Discovery & Attribution Copilot · v0.1"}</div>
        <h1 className={styles.heading}>
          {language === "English" ? "Discover overlooked AI channel GMV with conservative Shopify order attribution" : "发现被忽略的 AI 渠道 GMV，基于 Shopify 订单的保守归因"}
        </h1>
        <p className={styles.text}>
          {language === "English"
            ? "Automatically detects orders from ChatGPT / Perplexity / Gemini / Copilot. Provides dashboard, debug view, rules, and CSV export to help DTC brands evaluate whether AI channels are worth investing in."
            : "自动识别来自 ChatGPT / Perplexity / Gemini / Copilot 的订单，提供基础仪表盘、调试视图、规则配置与\n          CSV 导出，帮助中高阶 DTC 商家判断 AI 渠道是否值得投入。"}
        </p>
        <div className={styles.actions}>
          {showForm && (
            <Form className={styles.form} method="post" action="/auth/login">
              <label className={styles.label}>
                <span>{language === "English" ? "Shop domain" : "店铺域名"}</span>
                <input
                  className={styles.input}
                  type="text"
                  name="shop"
                  placeholder={language === "English" ? "your-store.myshopify.com" : "your-store.myshopify.com"}
                />
              </label>
              <button className={styles.button} type="submit">
                {language === "English" ? "Log in to Shopify" : "登录 Shopify 店铺"}
              </button>
            </Form>
          )}
          <div className={styles.chips}>
            <span>{language === "English" ? "Conservative: Referrer + UTM" : "Referrer + UTM 保守识别"}</span>
            <span>{language === "English" ? "AI GMV / Orders / New Customers" : "AI 渠道 GMV / 订单 / 新客"}</span>
            <span>{language === "English" ? "Top Products from AI Channels" : "AI 渠道热销产品"}</span>
            <span>{language === "English" ? "Tag write-back & CSV export" : "标签写回 & CSV 导出"}</span>
          </div>
          <div className={styles.chips}>
            <a href={language === "English" ? "?lang=zh" : "?lang=en"} className={styles.link}>
              {language === "English" ? "切换为中文" : "Switch to English"}
            </a>
          </div>
        </div>
      </div>

      <div className={styles.panel}>
        <div className={styles.panelSection}>
          <h3>{language === "English" ? "Features (v0.1)" : "v0.1 功能覆盖"}</h3>
          <ul>
            <li>{language === "English" ? "Data ingress: Shopify Admin API + orders/create webhook + 90-day backfill." : "数据接入：Shopify Admin API + orders/create webhook + 90 天补拉。"}</li>
            <li>{language === "English" ? "AI attribution: preset ChatGPT / Perplexity / Gemini / Copilot domains & UTM." : "AI 渠道识别：预置 ChatGPT / Perplexity / Gemini / Copilot 域名 & UTM。"}</li>
            <li>{language === "English" ? "Dashboard: GMV, Orders, New Customers, AOV, Repeat; AI vs Overall." : "基础仪表盘：GMV、订单、新客、AOV、复购，对比 AI vs Overall。"}</li>
            <li>{language === "English" ? "Debug view: recent orders' referrer/UTM/detection for rule verification." : "调试视图：最近订单的 referrer / UTM / 解析结果，便于核验规则。"}</li>
            <li>{language === "English" ? "Settings & Export: domain/UTM rules, tag write-back, language/timezone, order/product CSV." : "设置 & 导出：域名/UTM 规则、标签写回、语言时区、订单/产品 CSV。"}</li>
          </ul>
        </div>
        <div className={styles.panelSection}>
          <h3>{language === "English" ? "Who is it for?" : "适合谁？"}</h3>
          <p>
            {language === "English"
              ? "DTC brands with annual GMV of $200k–$5M; growth leads and analysts who want to quantify real GMV and AOV from AI assistants."
              : "年 GMV 20万-500万美金的 DTC 品牌主 / 增长负责人 / 数据分析师，希望量化 AI 助手带来的真实 GMV 与\n            客单表现。"}
          </p>
          <div className={styles.statsRow}>
            <div>
              <div className={styles.statLabel}>{language === "English" ? "AI New Customer Share" : "AI 新客占比"}</div>
              <div className={styles.statValue}>30-45%</div>
            </div>
            <div>
              <div className={styles.statLabel}>{language === "English" ? "AI AOV vs Overall" : "AI AOV 对比"}</div>
              <div className={styles.statValue}>+15-30%</div>
            </div>
            <div>
              <div className={styles.statLabel}>{language === "English" ? "Attribution" : "识别口径"}</div>
              <div className={styles.statValue}>{language === "English" ? "Conservative" : "保守估计"}</div>
            </div>
          </div>
        </div>
        <div className={styles.panelSection}>
          <h3>{language === "English" ? "Getting Started (basic data visible after install)" : "快速上手（安装后即可看到基础数据）"}</h3>
          <ol>
            <li>{language === "English" ? "Install and authorize the Shopify app; the backend auto backfills the last 90 days." : "安装 Shopify 应用并授权，后台会自动补拉最近 90 天订单。"}</li>
            <li>{language === "English" ? "Open Dashboard for AI GMV/Orders/New Customers. Default rules cover chat.openai.com, perplexity.ai, gemini.google.com, copilot.microsoft.com and utm_source=chatgpt/perplexity/gemini/copilot." : "Dashboard 查看 AI GMV / 订单 / 新客，默认规则已覆盖 chat.openai.com、perplexity.ai、\n              gemini.google.com、copilot.microsoft.com 与 utm_source=chatgpt/perplexity/gemini/copilot。"}</li>
            <li>{language === "English" ? "In Settings, adjust rules, enable tag write-back (off by default) and download CSV exports." : "在 Settings 调整识别规则、开启标签写回（默认关闭）并下载 CSV 导出。"}</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
