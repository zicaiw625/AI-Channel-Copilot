import { useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getSettings } from "../lib/settings.server";
import { resolveDateRange, type TimeRangeKey } from "../lib/aiData";
import { useUILanguage } from "../lib/useUILanguage";
import styles from "../styles/app.copilot.module.css";
import { hasFeature, FEATURES } from "../lib/access.server";
import { isDemoMode } from "../lib/runtime.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const demo = isDemoMode();
  let session;
  
  try {
    const auth = await authenticate.admin(request);
    session = auth.session;
  } catch (error) {
    if (!demo) {
      // If authentication fails and not in demo mode, redirect to app root
      // which will handle the onboarding flow
      const url = new URL(request.url);
      const redirectUrl = new URL("/app", url.origin);
      throw new Response(null, { 
        status: 302, 
        headers: { Location: redirectUrl.toString() } 
      });
    }
  }

  const shopDomain = session?.shop || "";
  
  // If no shop domain and not demo, redirect
  if (!shopDomain && !demo) {
    throw new Response(null, { 
      status: 302, 
      headers: { Location: "/app" } 
    });
  }
  
  const settings = await getSettings(shopDomain);
  const timezone = settings.timezones[0] || "UTC";
  const range = "30d" as TimeRangeKey;
  const dateRange = resolveDateRange(range, new Date(), undefined, undefined, timezone);
  
  const canUseCopilot = await hasFeature(shopDomain, FEATURES.COPILOT);
  
  // If demo, allow; otherwise check feature access
  const readOnly = !canUseCopilot && !demo;

  return { shopDomain, settings, timezone, dateRange, range, readOnly, demo };
};

export default function Copilot() {
  const { settings, dateRange, range, readOnly, demo } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const [question, setQuestion] = useState("");
  // 使用 useUILanguage 保持语言设置的客户端一致性
  const language = useUILanguage(settings.languages[0] || "中文");
  
  const isLoading = fetcher.state !== "idle";

  const ask = (intent?: string) => {
    if (readOnly) return;
    const payload: Record<string, string> = intent ? { intent } : { question };
    fetcher.submit(
      { ...payload, range, from: dateRange.fromParam || "", to: dateRange.toParam || "" },
      { method: "post", action: "/api/copilot" },
    );
  };
  
  const UpgradeBanner = () => (
      <div style={{
          background: "#fff2e8",
          border: "1px solid #ffbb96",
          padding: "16px",
          marginBottom: "20px",
          borderRadius: "8px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center"
      }}>
          <div>
            <h3 style={{ margin: "0 0 8px 0", color: "#d4380d" }}>
                {language === "English" ? "Pro Feature" : "Pro 功能"}
            </h3>
            <p style={{ margin: 0 }}>
                {language === "English" 
                  ? "AI Copilot requires a Pro plan. Upgrade to unlock instant answers." 
                  : "AI Copilot 需要 Pro 计划。升级以解锁智能问答。"}
            </p>
          </div>
          <Link to="/app/onboarding?step=plan_selection" className={styles.primaryButton}>
              {language === "English" ? "Upgrade to Pro" : "升级到 Pro"}
          </Link>
      </div>
  );

  return (
    <s-page heading={language === "English" ? "Copilot Q&A (v0.2 Experimental)" : "Copilot 分析问答（v0.2 实验）"}>
      <div className={styles.page}>
        <div className={styles.lede}>
          <h1>{language === "English" ? "Quick Q&A based on fixed intents" : "基于固定意图的快捷问答"}</h1>
          <p>{language === "English" ? "This page uses fixed templates to generate natural language from aggregated JSON without asking the model to compute numbers. Prefer quick buttons for best results." : "本页采用固定模板，直接从聚合 JSON 中生成自然语言解读，不会让模型自行计算数字。推荐优先使用下方快捷按钮以获得更稳定结果。"}</p>
          <div className={styles.inlineNote}>
            <span>{language === "English" ? "GMV Metric: " : "GMV 口径："}{settings.gmvMetric}</span>
            <span>{language === "English" ? "Time Range: " : "时间范围："}{dateRange.label}</span>
            {demo && <span style={{ color: "#0050b3" }}>{language === "English" ? "(Demo Mode)" : "（Demo 模式）"}</span>}
          </div>
        </div>

        {readOnly && <UpgradeBanner />}
        
        <div className={styles.quickButtons} style={readOnly ? { opacity: 0.5, pointerEvents: "none" } : {}}>
          <button 
            type="button"
            className={styles.primaryButton} 
            onClick={() => ask("ai_performance")}
            disabled={readOnly || isLoading}
            data-action="copilot-ai_performance"
          >
            {isLoading ? (language === "English" ? "Loading..." : "加载中...") : (language === "English" ? "AI channel performance in last 30 days?" : "过去 30 天 AI 渠道表现如何？")}
          </button>
          <button 
            type="button"
            className={styles.secondaryButton} 
            onClick={() => ask("ai_vs_all_aov")}
            disabled={readOnly || isLoading}
            data-action="copilot-ai_vs_all_aov"
          >
            {language === "English" ? "AI channel vs all channels AOV?" : "AI 渠道 vs 全部渠道 AOV？"}
          </button>
          <button 
            type="button"
            className={styles.secondaryButton} 
            onClick={() => ask("ai_top_products")}
            disabled={readOnly || isLoading}
            data-action="copilot-ai_top_products"
          >
            {language === "English" ? "Top-selling products from AI channels recently?" : "最近 AI 渠道销量最高的产品？"}
          </button>
        </div>

        <div className={styles.askBlock} style={readOnly ? { opacity: 0.5, pointerEvents: "none" } : {}}>
          <input
            className={styles.input}
            placeholder={language === "English" ? "Type your question (limited intents: performance/overview/trend, compare/vs, top/bestsellers)" : "输入你的问题（目前仅支持有限类型：表现/概览/趋势、对比/VS、Top/热销）"}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            disabled={readOnly}
          />
          <button type="button" className={styles.primaryButton} onClick={() => ask()} disabled={readOnly || isLoading} data-action="copilot-ask">
            {isLoading ? (language === "English" ? "Loading..." : "加载中...") : (language === "English" ? "Ask" : "提问")}
          </button>
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
