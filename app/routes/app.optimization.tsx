import { useCallback, useEffect, useMemo, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData, useNavigate, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { getSettings } from "../lib/settings.server";
import { generateAIOptimizationReport, type OptimizationSuggestion } from "../lib/aiOptimization.server";
import { useUILanguage } from "../lib/useUILanguage";
import styles from "../styles/app.dashboard.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  let admin, session;
  
  try {
    const auth = await authenticate.admin(request);
    admin = auth.admin;
    session = auth.session;
  } catch {
    // Handle auth failure
  }

  const shopDomain = session?.shop || "";
  const settings = await getSettings(shopDomain);
  
  // 优先从 URL 参数读取语言（最可靠的方式，避免 cookie 在 iframe 中的问题）
  const url = new URL(request.url);
  const urlLanguage = url.searchParams.get("lang");
  
  // 其次尝试从 cookie 读取
  const cookieHeader = request.headers.get("Cookie") || "";
  const cookieLanguageMatch = cookieHeader.match(/aicc_language=([^;]+)/);
  const cookieLanguage = cookieLanguageMatch 
    ? decodeURIComponent(cookieLanguageMatch[1]) 
    : null;
  
  // 优先级：URL 参数 > cookie > 数据库设置
  const language = urlLanguage || cookieLanguage || settings.languages?.[0] || "中文";

  const report = await generateAIOptimizationReport(shopDomain, admin, {
    range: "30d",
    language,
    exposurePreferences: settings.exposurePreferences,
  });

  return {
    report,
    language,
    shopDomain,
  };
};

const ScoreGauge = ({ score, label }: { score: number; label: string }) => {
  const color = score >= 70 ? "#50b83c" : score >= 40 ? "#f4a623" : "#de3618";
  const circumference = 2 * Math.PI * 45;
  const offset = circumference - (score / 100) * circumference;
  
  return (
    <div style={{ textAlign: "center" }}>
      <svg width="120" height="120" viewBox="0 0 120 120">
        <circle
          cx="60"
          cy="60"
          r="45"
          fill="none"
          stroke="#e0e0e0"
          strokeWidth="10"
        />
        <circle
          cx="60"
          cy="60"
          r="45"
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 60 60)"
          style={{ transition: "stroke-dashoffset 0.5s ease" }}
        />
        <text
          x="60"
          y="60"
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="24"
          fontWeight="bold"
          fill={color}
        >
          {score}
        </text>
      </svg>
      <p style={{ marginTop: 8, fontSize: 14, color: "#637381" }}>{label}</p>
    </div>
  );
};

const SuggestionCard = ({ 
  suggestion, 
  language,
  expanded,
  onToggle,
}: { 
  suggestion: OptimizationSuggestion; 
  language: string;
  expanded: boolean;
  onToggle: () => void;
}) => {
  const isEnglish = language === "English";
  const priorityColors = {
    high: { bg: "#fef3f3", border: "#de3618", text: "#de3618" },
    medium: { bg: "#fff8e5", border: "#f4a623", text: "#8a6116" },
    low: { bg: "#f0f8f4", border: "#50b83c", text: "#2e7d32" },
  };
  const colors = priorityColors[suggestion.priority];
  
  const categoryLabels: Record<string, { en: string; zh: string }> = {
    schema_markup: { en: "Schema Markup", zh: "结构化标记" },
    content_quality: { en: "Content Quality", zh: "内容质量" },
    faq_coverage: { en: "FAQ Coverage", zh: "FAQ 覆盖" },
    product_info: { en: "Product Info", zh: "产品信息" },
    ai_visibility: { en: "AI Visibility", zh: "AI 可见性" },
  };
  
  return (
    <div
      style={{
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        padding: 16,
        marginBottom: 12,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <span
              style={{
                background: colors.border,
                color: "white",
                padding: "2px 8px",
                borderRadius: 4,
                fontSize: 12,
                fontWeight: 500,
              }}
            >
              {suggestion.priority.toUpperCase()}
            </span>
            <span style={{ fontSize: 12, color: "#637381" }}>
              {isEnglish 
                ? categoryLabels[suggestion.category]?.en 
                : categoryLabels[suggestion.category]?.zh}
            </span>
          </div>
          <h4 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 600 }}>
            {suggestion.title}
          </h4>
          <p style={{ margin: 0, fontSize: 14, color: "#555" }}>
            {suggestion.description}
          </p>
        </div>
        {suggestion.estimatedLift && (
          <span
            style={{
              background: "#e6f7ff",
              color: "#0050b3",
              padding: "4px 8px",
              borderRadius: 4,
              fontSize: 12,
              fontWeight: 500,
              whiteSpace: "nowrap",
            }}
          >
            {suggestion.estimatedLift}
          </span>
        )}
      </div>
      
      {expanded && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid rgba(0,0,0,0.1)" }}>
          <div style={{ marginBottom: 12 }}>
            <strong style={{ fontSize: 14 }}>{isEnglish ? "Impact:" : "影响："}</strong>
            <p style={{ margin: "4px 0 0", fontSize: 14, color: "#555" }}>{suggestion.impact}</p>
          </div>
          <div style={{ marginBottom: 12 }}>
            <strong style={{ fontSize: 14 }}>{isEnglish ? "Action:" : "行动："}</strong>
            <p style={{ margin: "4px 0 0", fontSize: 14, color: "#555" }}>{suggestion.action}</p>
          </div>
          {suggestion.codeSnippet && (
            <div>
              <strong style={{ fontSize: 14 }}>{isEnglish ? "Code Example:" : "代码示例："}</strong>
              <pre
                style={{
                  background: "#f4f6f8",
                  padding: 12,
                  borderRadius: 4,
                  overflow: "auto",
                  fontSize: 12,
                  marginTop: 4,
                }}
              >
                {suggestion.codeSnippet}
              </pre>
            </div>
          )}
          {suggestion.affectedProducts && suggestion.affectedProducts.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <strong style={{ fontSize: 14 }}>
                {isEnglish ? "Affected Products:" : "受影响产品："}
                <span style={{ fontWeight: "normal", color: "#637381" }}>
                  {" "}({suggestion.affectedProducts.length})
                </span>
              </strong>
            </div>
          )}
        </div>
      )}
      
      <button
        type="button"
        onClick={onToggle}
        style={{
          marginTop: 12,
          background: "transparent",
          border: "none",
          color: colors.text,
          cursor: "pointer",
          fontSize: 14,
          padding: 0,
        }}
      >
        {expanded 
          ? (isEnglish ? "Show Less ▲" : "收起 ▲")
          : (isEnglish ? "Show Details ▼" : "查看详情 ▼")}
      </button>
    </div>
  );
};

export default function AIOptimization() {
  const { report, language, shopDomain: _shopDomain } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  
  // 监听语言变化事件，当用户在其他页面切换语言时触发重新加载
  const uiLanguage = useUILanguage(language);
  
  // 当 localStorage 中的语言与后端返回的语言不一致时，通过 URL 参数重新加载
  // 使用 URL 参数而非 cookie，避免 Shopify iframe 中的第三方 cookie 限制
  useEffect(() => {
    if (uiLanguage !== language) {
      // 只有当 URL 中没有 lang 参数或参数值与 uiLanguage 不同时才导航
      const currentLangParam = searchParams.get("lang");
      if (currentLangParam !== uiLanguage) {
        navigate(`/app/optimization?lang=${encodeURIComponent(uiLanguage)}`, { replace: true });
      }
    }
  }, [uiLanguage, language, navigate, searchParams]);
  
  // 使用后端返回的语言来保证 UI 和数据内容一致
  const isEnglish = language === "English";
  
  const [expandedSuggestions, setExpandedSuggestions] = useState<Set<string>>(new Set());
  
  const toggleSuggestion = useCallback((id: string) => {
    setExpandedSuggestions(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);
  
  const highPrioritySuggestions = useMemo(
    () => report.suggestions.filter(s => s.priority === "high"),
    [report.suggestions]
  );
  
  const otherSuggestions = useMemo(
    () => report.suggestions.filter(s => s.priority !== "high"),
    [report.suggestions]
  );

  return (
    <s-page heading={isEnglish ? "AI Optimization" : "AI 优化建议"}>
      <div className={styles.page}>
        {/* 顶部导航 */}
        <div style={{ marginBottom: 16, display: "flex", gap: 12 }}>
          <Link to="/app" className={styles.secondaryButton}>
            ← {isEnglish ? "Back to Dashboard" : "返回仪表盘"}
          </Link>
          <Link to="/app/funnel" className={styles.primaryButton}>
            {isEnglish ? "View Funnel Analysis" : "查看漏斗分析"} →
          </Link>
        </div>

        {/* 总览分数 */}
        <div className={styles.card}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.sectionLabel}>{isEnglish ? "Overall Score" : "总体评分"}</p>
              <h3 className={styles.sectionTitle}>
                {isEnglish ? "AI Visibility & Content Quality" : "AI 可见性与内容质量"}
              </h3>
            </div>
            <span className={styles.badge}>
              {isEnglish ? "Beta" : "测试版"}
            </span>
          </div>
          
          <div style={{ display: "flex", justifyContent: "space-around", padding: "20px 0" }}>
            <ScoreGauge 
              score={report.overallScore} 
              label={isEnglish ? "Overall" : "总分"} 
            />
            <ScoreGauge 
              score={report.scoreBreakdown.schemaMarkup} 
              label={isEnglish ? "Schema Markup" : "结构化标记"} 
            />
            <ScoreGauge 
              score={report.scoreBreakdown.contentQuality} 
              label={isEnglish ? "Content Quality" : "内容质量"} 
            />
            <ScoreGauge 
              score={report.scoreBreakdown.productCompleteness} 
              label={isEnglish ? "Product Info" : "产品完整度"} 
            />
          </div>
          
          {report.topProducts.length === 0 ? (
            <div
              style={{
                background: "#fff8e5",
                border: "1px solid #f4a623",
                borderRadius: 8,
                padding: 16,
                marginBottom: 12,
              }}
            >
              <p style={{ margin: 0, fontSize: 14, color: "#8a6116" }}>
                <strong>{isEnglish ? "No AI order data yet." : "暂无 AI 订单数据。"}</strong>{" "}
                {isEnglish
                  ? "Scores will be calculated once you receive orders from AI channels. Follow the suggestions below to improve your AI visibility."
                  : "当您收到来自 AI 渠道的订单后，评分将会自动计算。请参考下方建议来提升您的 AI 可见性。"}
              </p>
            </div>
          ) : (
            <p className={styles.helpText}>
              {isEnglish 
                ? "Scores are based on your top AI-performing products. Higher scores indicate better AI discoverability."
                : "评分基于您 AI 渠道表现最好的产品。分数越高表示 AI 可发现性越好。"}
            </p>
          )}
        </div>

        {/* 高优先级建议 */}
        {highPrioritySuggestions.length > 0 && (
          <div className={styles.card}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.sectionLabel}>{isEnglish ? "Priority Actions" : "优先行动"}</p>
                <h3 className={styles.sectionTitle}>
                  {isEnglish ? "High-Impact Improvements" : "高影响力改进"}
                </h3>
              </div>
              <span className={styles.badge} style={{ background: "#de3618", color: "white" }}>
                {highPrioritySuggestions.length} {isEnglish ? (highPrioritySuggestions.length === 1 ? "item" : "items") : "项"}
              </span>
            </div>
            
            {highPrioritySuggestions.map(suggestion => (
              <SuggestionCard
                key={suggestion.id}
                suggestion={suggestion}
                language={language}
                expanded={expandedSuggestions.has(suggestion.id)}
                onToggle={() => toggleSuggestion(suggestion.id)}
              />
            ))}
          </div>
        )}

        {/* 其他建议 */}
        {otherSuggestions.length > 0 && (
          <div className={styles.card}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.sectionLabel}>{isEnglish ? "Additional Suggestions" : "其他建议"}</p>
                <h3 className={styles.sectionTitle}>
                  {isEnglish ? "Optimization Opportunities" : "优化机会"}
                </h3>
              </div>
            </div>
            
            {otherSuggestions.map(suggestion => (
              <SuggestionCard
                key={suggestion.id}
                suggestion={suggestion}
                language={language}
                expanded={expandedSuggestions.has(suggestion.id)}
                onToggle={() => toggleSuggestion(suggestion.id)}
              />
            ))}
          </div>
        )}

        {/* Top AI 产品分析 */}
        <div className={styles.card}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.sectionLabel}>{isEnglish ? "Product Analysis" : "产品分析"}</p>
              <h3 className={styles.sectionTitle}>
                {isEnglish ? "Top AI-Performing Products" : "AI 渠道表现最佳产品"}
              </h3>
            </div>
          </div>
          
          {report.topProducts.length > 0 ? (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>{isEnglish ? "Product" : "产品"}</th>
                    <th>{isEnglish ? "AI GMV" : "AI GMV"}</th>
                    <th>{isEnglish ? "AI Orders" : "AI 订单"}</th>
                    <th>{isEnglish ? "Top Channel" : "主要渠道"}</th>
                    <th>{isEnglish ? "Schema Status" : "Schema 状态"}</th>
                    <th>{isEnglish ? "Improvements" : "改进项"}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.topProducts.map(product => (
                    <tr key={product.productId}>
                      <td className={styles.cellLabel}>
                        <a href={product.url} target="_blank" rel="noreferrer" className={styles.link}>
                          {product.title}
                        </a>
                      </td>
                      <td>${product.aiGMV.toFixed(2)}</td>
                      <td>{product.aiOrders}</td>
                      <td>{product.topChannel || "-"}</td>
                      <td>
                        <span
                          style={{
                            padding: "2px 8px",
                            borderRadius: 4,
                            fontSize: 12,
                            background: product.schemaMarkupStatus === "complete" 
                              ? "#e6f7ed" 
                              : product.schemaMarkupStatus === "partial"
                                ? "#fff8e5"
                                : "#fef3f3",
                            color: product.schemaMarkupStatus === "complete"
                              ? "#2e7d32"
                              : product.schemaMarkupStatus === "partial"
                                ? "#8a6116"
                                : "#de3618",
                          }}
                        >
                          {product.schemaMarkupStatus === "complete"
                            ? (isEnglish ? "Complete" : "完整")
                            : product.schemaMarkupStatus === "partial"
                              ? (isEnglish ? "Partial" : "部分")
                              : (isEnglish ? "Missing" : "缺失")}
                        </span>
                      </td>
                      <td>
                        {product.suggestedImprovements.length > 0 
                          ? product.suggestedImprovements.length
                          : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div
              style={{
                textAlign: "center",
                padding: "40px 20px",
                background: "#f9fafb",
                borderRadius: 8,
                color: "#637381",
              }}
            >
              <p style={{ margin: "0 0 8px", fontSize: 16 }}>
                {isEnglish 
                  ? "No AI-attributed orders yet" 
                  : "暂无 AI 渠道订单数据"}
              </p>
              <p style={{ margin: 0, fontSize: 14 }}>
                {isEnglish
                  ? "Product analysis will appear once you receive orders from AI assistants like ChatGPT, Perplexity, etc."
                  : "当您收到来自 ChatGPT、Perplexity 等 AI 助手的订单后，产品分析将会显示在这里。"}
              </p>
            </div>
          )}
        </div>

        {/* FAQ 建议 */}
        {report.suggestedFAQs.length > 0 && (
          <div className={styles.card}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.sectionLabel}>{isEnglish ? "FAQ Suggestions" : "FAQ 建议"}</p>
                <h3 className={styles.sectionTitle}>
                  {isEnglish ? "Recommended FAQ Content" : "推荐的 FAQ 内容"}
                </h3>
              </div>
              <span className={styles.badge}>
                {report.suggestedFAQs.length} {isEnglish ? "suggestions" : "条建议"}
              </span>
            </div>
            
            <p className={styles.helpText} style={{ marginBottom: 16 }}>
              {isEnglish
                ? "Add these FAQs to your product pages to help AI assistants answer customer questions."
                : "将这些 FAQ 添加到产品页面，帮助 AI 助手回答客户问题。"}
            </p>
            
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {report.suggestedFAQs.map((faq, index) => (
                <div
                  key={index}
                  style={{
                    background: "#f4f6f8",
                    borderRadius: 8,
                    padding: 16,
                  }}
                >
                  <p style={{ margin: "0 0 8px", fontWeight: 600, color: "#212b36" }}>
                    Q: {faq.question}
                  </p>
                  <p style={{ margin: 0, color: "#555" }}>
                    A: {faq.suggestedAnswer}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* llms.txt 增强建议 */}
        <div className={styles.card}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.sectionLabel}>{isEnglish ? "llms.txt Enhancement" : "llms.txt 增强"}</p>
              <h3 className={styles.sectionTitle}>
                {isEnglish ? "AI Crawling Recommendations" : "AI 抓取建议"}
              </h3>
            </div>
          </div>
          
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <span style={{ fontWeight: 600 }}>
                {isEnglish ? "Current Coverage:" : "当前覆盖率："}
              </span>
              <div
                style={{
                  flex: 1,
                  height: 8,
                  background: "#e0e0e0",
                  borderRadius: 4,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${report.llmsEnhancements.currentCoverage}%`,
                    height: "100%",
                    background: "#50b83c",
                    transition: "width 0.3s ease",
                  }}
                />
              </div>
              <span style={{ fontWeight: 600 }}>{report.llmsEnhancements.currentCoverage}%</span>
            </div>
          </div>
          
          <div style={{ marginBottom: 16 }}>
            <strong>{isEnglish ? "Recommended Actions:" : "推荐操作："}</strong>
            <ul style={{ margin: "8px 0", paddingLeft: 20 }}>
              {report.llmsEnhancements.categoryRecommendations.map((rec, i) => (
                <li key={i} style={{ marginBottom: 4, color: "#555" }}>{rec}</li>
              ))}
            </ul>
          </div>
          
          <Link to="/app/additional" className={styles.primaryButton}>
            {isEnglish ? "Configure llms.txt Settings" : "配置 llms.txt 设置"}
          </Link>
        </div>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
