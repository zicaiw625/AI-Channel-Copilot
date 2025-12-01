import { useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getSettings } from "../lib/settings.server";
import { resolveDateRange, type TimeRangeKey } from "../lib/aiData";
import styles from "../styles/app.copilot.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session?.shop || "";
  const settings = await getSettings(shopDomain);
  const timezone = settings.timezones[0] || "UTC";
  const range = "30d" as TimeRangeKey;
  const dateRange = resolveDateRange(range, new Date(), undefined, undefined, timezone);
  return { shopDomain, settings, timezone, dateRange, range };
};

export default function Copilot() {
  const { settings, dateRange, range } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const [question, setQuestion] = useState("");
  const language = settings.languages[0] || "中文";

  const ask = (intent?: string) => {
    const payload: Record<string, string> = intent ? { intent } : { question };
    fetcher.submit(
      { ...payload, range, from: dateRange.fromParam || "", to: dateRange.toParam || "" },
      { method: "post", action: "/api/copilot" },
    );
  };

  return (
    <s-page heading={language === "English" ? "Copilot Q&A (v0.2 Experimental)" : "Copilot 分析问答（v0.2 实验）"}>
      <div className={styles.page}>
        <div className={styles.lede}>
          <h1>{language === "English" ? "Quick Q&A based on fixed intents" : "基于固定意图的快捷问答"}</h1>
          <p>{language === "English" ? "This page uses fixed templates to generate natural language from aggregated JSON without asking the model to compute numbers. Prefer quick buttons for best results." : "本页采用固定模板，直接从聚合 JSON 中生成自然语言解读，不会让模型自行计算数字。推荐优先使用下方快捷按钮以获得更稳定结果。"}</p>
          <div className={styles.inlineNote}>
            <span>{language === "English" ? "GMV Metric: " : "GMV 口径："}{settings.gmvMetric}</span>
            <span>{language === "English" ? "Time Range: " : "时间范围："}{dateRange.label}</span>
          </div>
        </div>

        <div className={styles.quickButtons}>
          <button className={styles.primaryButton} onClick={() => ask("ai_performance")}>{language === "English" ? "AI channel performance in last 30 days?" : "过去 30 天 AI 渠道表现如何？"}</button>
          <button className={styles.secondaryButton} onClick={() => ask("ai_vs_all_aov")}>{language === "English" ? "AI channel vs all channels AOV?" : "AI 渠道 vs 全部渠道 AOV？"}</button>
          <button className={styles.secondaryButton} onClick={() => ask("ai_top_products")}>{language === "English" ? "Top-selling products from AI channels recently?" : "最近 AI 渠道销量最高的产品？"}</button>
        </div>

        <div className={styles.askBlock}>
          <input
            className={styles.input}
            placeholder={language === "English" ? "Type your question (limited intents: performance/overview/trend, compare/vs, top/bestsellers)" : "输入你的问题（目前仅支持有限类型：表现/概览/趋势、对比/VS、Top/热销）"}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <button className={styles.primaryButton} onClick={() => ask()}>{language === "English" ? "Ask" : "提问"}</button>
        </div>

        {fetcher.data && (
          <div className={styles.answerCard}>
            <div className={styles.answerHeader}>{language === "English" ? "Answer" : "回答"}</div>
            <div className={styles.answerBody}>{fetcher.data.answer || fetcher.data.message}</div>
            {fetcher.data.footnote && <div className={styles.footnote}>{fetcher.data.footnote}</div>}
          </div>
        )}

        <div className={styles.smallNote}>
          {language === "English" ? "Copilot is experimental: generates narrative from aggregated results only; not guaranteed to be real-time or exhaustive. Cross-check on the dashboard." : "Copilot 为实验特性：仅从聚合结果生成自然语言，不保证即时性与完整性。建议在仪表盘交叉验证。"}
        </div>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
