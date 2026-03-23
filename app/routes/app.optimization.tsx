import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
// useRef is used for: timer cleanup in CopyButton, and storing latest searchParams/navigate refs
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData, useLocation, useNavigate, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { getSettings } from "../lib/settings.server";
import { generateAIOptimizationReport, type OptimizationSuggestion } from "../lib/aiOptimization.server";
import { useUILanguage } from "../lib/useUILanguage";
import { requireEnv } from "../lib/env.server";
import { buildEmbeddedAppPath } from "../lib/navigation";
import styles from "../styles/app.dashboard.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  const shopDomain = session.shop;
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
  
  // 获取店铺货币设置
  const currency = settings.primaryCurrency || "USD";

  // 获取 API Key 用于生成带 activateAppId 的 deep link
  const apiKey = requireEnv("SHOPIFY_API_KEY");

  const report = await generateAIOptimizationReport(shopDomain, admin, {
    range: "30d",
    language,
    exposurePreferences: settings.exposurePreferences,
    apiKey,
  });

  return {
    report,
    language,
    shopDomain,
    currency,
  };
};

/**
 * 一键复制按钮组件
 */
const CopyButton = ({ 
  text, 
  isEnglish,
  size = "normal",
}: { 
  text: string; 
  isEnglish: boolean;
  size?: "small" | "normal";
}) => {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 清理 timer 防止内存泄漏
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const handleCopy = useCallback(async (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    // 清理之前的 timer
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers that don't support navigator.clipboard API
      // Note: document.execCommand("copy") is deprecated but kept for compatibility
      // with older browsers (Safari < 13.1, IE, etc.)
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy"); // Fallback for older browsers
      document.body.removeChild(textarea);
      setCopied(true);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    }
  }, [text]);

  const padding = size === "small" ? "4px 8px" : "6px 12px";
  const fontSize = size === "small" ? 11 : 12;

  const buttonLabel = copied 
    ? (isEnglish ? "Copied!" : "已复制！") 
    : (isEnglish ? "Copy" : "复制");

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={isEnglish ? "Copy to clipboard" : "复制到剪贴板"}
      aria-live="polite"
      style={{
        padding,
        fontSize,
        fontWeight: 500,
        background: copied ? "#52c41a" : "#fff",
        color: copied ? "#fff" : "#333",
        border: copied ? "1px solid #52c41a" : "1px solid #d9d9d9",
        borderRadius: 4,
        cursor: "pointer",
        transition: "all 0.2s",
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
      }}
    >
      <span aria-hidden="true">{copied ? "✓" : "📋"}</span>
      {buttonLabel}
    </button>
  );
};

/**
 * 代码片段区块组件 - 带复制按钮
 */
const CodeSnippetBlock = ({ 
  code, 
  isEnglish 
}: { 
  code: string; 
  isEnglish: boolean;
}) => {
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ 
        display: "flex", 
        justifyContent: "space-between", 
        alignItems: "center",
        marginBottom: 8,
      }}>
        <strong style={{ fontSize: 14 }}>
          {isEnglish ? "Code Example:" : "代码示例："}
        </strong>
        <CopyButton text={code} isEnglish={isEnglish} size="small" />
      </div>
      <pre
        style={{
          background: "#f4f6f8",
          padding: 12,
          borderRadius: 4,
          overflow: "auto",
          fontSize: 12,
          margin: 0,
          position: "relative",
        }}
      >
        {code}
      </pre>
      <p style={{ 
        margin: "8px 0 0", 
        fontSize: 11, 
        color: "#888",
        display: "flex",
        alignItems: "center",
        gap: 4,
      }}>
        💡 {isEnglish 
          ? "Copy this code and add it to your theme or product pages." 
          : "复制此代码并添加到您的主题或产品页面中。"}
      </p>
    </div>
  );
};

const ScoreGauge = ({ score, label, id }: { score: number; label: string; id: string }) => {
  const color = score >= 70 ? "#50b83c" : score >= 40 ? "#f4a623" : "#de3618";
  const circumference = 2 * Math.PI * 45;
  const offset = circumference - (score / 100) * circumference;
  // 使用传入的英文 id 作为标识符，避免中文标签导致的 ID 问题
  const gaugeId = `gauge-${id}`;
  
  return (
    <div style={{ textAlign: "center" }}>
      <svg 
        width="120" 
        height="120" 
        viewBox="0 0 120 120"
        role="img"
        aria-labelledby={gaugeId}
      >
        <title id={gaugeId}>{label}: {score}/100</title>
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
          aria-hidden="true"
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
  const location = useLocation();
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

  // 特殊处理：某些建议直接跳转到对应页面
  const isSchemaEmbedSuggestion = suggestion.id === "schema-embed-disabled";
  const isLlmsTxtSuggestion = suggestion.id === "llms-txt-optimization";
  const quickActionHref = isSchemaEmbedSuggestion
    ? buildEmbeddedAppPath("/app/ai-visibility", location.search, { tab: "schema" }, "#product-schema-settings")
    : buildEmbeddedAppPath("/app/ai-visibility", location.search, { tab: "llms" });
  
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
        <div style={{ flex: 1 }}>
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
            {isEnglish ? suggestion.title.en : suggestion.title.zh}
          </h4>
          <p style={{ margin: 0, fontSize: 14, color: "#555" }}>
            {isEnglish ? suggestion.description.en : suggestion.description.zh}
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

      {/* 特殊建议：显示快速操作按钮 */}
      {(isSchemaEmbedSuggestion || isLlmsTxtSuggestion) && (
        <div style={{ marginTop: 12 }}>
          <Link
            to={quickActionHref}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "10px 20px",
              background: "#008060",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            {isSchemaEmbedSuggestion 
              ? `🚀 ${isEnglish ? "Enable Now" : "立即启用"}`
              : `⚙️ ${isEnglish ? "Configure Now" : "立即配置"}`
            }
          </Link>
        </div>
      )}
      
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
            <CodeSnippetBlock 
              code={suggestion.codeSnippet} 
              isEnglish={isEnglish} 
            />
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
        aria-expanded={expanded}
        aria-label={expanded 
          ? (isEnglish ? "Collapse details" : "收起详情")
          : (isEnglish ? "Expand details" : "展开详情")}
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

/**
 * 状态配置映射 - 避免嵌套三元运算符
 */
const STATUS_CONFIG = {
  complete: { 
    bg: "#e6f7ed", 
    color: "#2e7d32", 
    label: { en: "Complete", zh: "完整" } 
  },
  partial: { 
    bg: "#fff8e5", 
    color: "#8a6116", 
    label: { en: "Partial", zh: "部分" } 
  },
  missing: { 
    bg: "#fef3f3", 
    color: "#de3618", 
    label: { en: "Missing", zh: "缺失" } 
  },
} as const;

/**
 * 格式化货币显示
 */
const formatCurrency = (amount: number, currency: string, isEnglish: boolean): string => {
  return new Intl.NumberFormat(isEnglish ? "en-US" : "zh-CN", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
};

/**
 * 状态标签组件 - 复用 schemaMarkupStatus 显示逻辑
 */
const StatusBadge = ({ 
  status, 
  isEnglish 
}: { 
  status: "complete" | "partial" | "missing"; 
  isEnglish: boolean;
}) => {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.missing;
  
  return (
    <span
      style={{
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 12,
        background: config.bg,
        color: config.color,
      }}
    >
      {isEnglish ? config.label.en : config.label.zh}
    </span>
  );
};

export default function AIOptimization() {
  const { report, language, shopDomain: _shopDomain, currency } = useLoaderData<typeof loader>();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  
  // 监听语言变化事件，当用户在其他页面切换语言时触发重新加载
  const uiLanguage = useUILanguage(language);
  
  // 当 localStorage 中的语言与后端返回的语言不一致时，通过 URL 参数重新加载
  // 使用 URL 参数而非 cookie，避免 Shopify iframe 中的第三方 cookie 限制
  // 使用 ref 存储最新的 searchParams 和 navigate，避免将它们加入依赖数组
  const searchParamsRef = useRef(searchParams);
  const navigateRef = useRef(navigate);
  
  useEffect(() => {
    searchParamsRef.current = searchParams;
    navigateRef.current = navigate;
  }, [searchParams, navigate]);
  
  useEffect(() => {
    if (uiLanguage !== language) {
      // 只有当 URL 中没有 lang 参数或参数值与 uiLanguage 不同时才导航
      const currentLangParam = searchParamsRef.current.get("lang");
      if (currentLangParam !== uiLanguage) {
        const next = new URLSearchParams(searchParamsRef.current);
        next.set("lang", uiLanguage);
        navigateRef.current({ pathname: "/app/optimization", search: `?${next.toString()}` }, { replace: true });
      }
    }
  }, [uiLanguage, language]);
  
  // 使用后端返回的语言来保证 UI 和数据内容一致
  const isEnglish = language === "English";
  const dashboardHref = buildEmbeddedAppPath("/app", location.search);
  const funnelHref = buildEmbeddedAppPath("/app/funnel", location.search);
  const workspaceLlmsHref = buildEmbeddedAppPath("/app/ai-visibility", location.search, { tab: "llms" });
  
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
          <Link to={dashboardHref} className={styles.secondaryButton}>
            ← {isEnglish ? "Back to Dashboard" : "返回仪表盘"}
          </Link>
          <Link to={funnelHref} className={styles.primaryButton}>
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
          </div>
          
          <div style={{ display: "flex", justifyContent: "space-around", padding: "20px 0", flexWrap: "wrap", gap: "16px" }}>
            <ScoreGauge 
              score={report.overallScore} 
              label={isEnglish ? "Overall" : "总分"}
              id="overall"
            />
            <ScoreGauge 
              score={report.scoreBreakdown.schemaMarkup} 
              label={isEnglish ? "Schema Markup" : "结构化标记"}
              id="schema-markup"
            />
            <ScoreGauge 
              score={report.scoreBreakdown.contentQuality} 
              label={isEnglish ? "Content Quality" : "内容质量"}
              id="content-quality"
            />
            <ScoreGauge 
              score={report.scoreBreakdown.faqCoverage} 
              label={isEnglish ? "FAQ Coverage" : "FAQ 覆盖"}
              id="faq-coverage"
            />
            <ScoreGauge 
              score={report.scoreBreakdown.productCompleteness} 
              label={isEnglish ? "Product Info" : "产品完整度"}
              id="product-completeness"
            />
          </div>
          
          {report.topProducts.length === 0 ? (
            <div
              style={{
                background: "#e6f7ff",
                border: "1px solid #91d5ff",
                borderRadius: 8,
                padding: 16,
                marginBottom: 12,
              }}
            >
              <p style={{ margin: 0, fontSize: 14, color: "#0050b3" }}>
                <strong>{isEnglish ? "AI Readiness Score" : "AI 就绪度评分"}</strong>{" "}
                {isEnglish
                  ? "Scores are calculated based on your product content quality. Once you receive AI orders, scores will reflect your top-performing products."
                  : "评分基于您店铺产品的内容质量计算。当您收到 AI 订单后，评分将基于表现最好的产品进行计算。"}
              </p>
            </div>
          ) : (
            <p className={styles.helpText}>
              {isEnglish 
                ? "Scores are based on your top AI-performing products. Higher scores indicate better AI discoverability."
                : "评分基于您 AI 渠道表现最好的产品。分数越高表示 AI 可发现性越好。"}
            </p>
          )}
          
          {/* AI 流量检测限制说明 */}
          <div
            style={{
              background: "#fffbe6",
              border: "1px solid #ffe58f",
              borderRadius: 8,
              padding: 16,
              marginTop: 12,
            }}
          >
            <p style={{ margin: 0, fontSize: 13, color: "#614700" }}>
              <strong>⚠️ {isEnglish ? "Detection Limitations" : "检测限制说明"}</strong>
              <br />
              {isEnglish
                ? "AI traffic detection depends on referrer data and UTM parameters. Some AI platforms may not send referrer headers when users click links. For best results, encourage AI platforms to include UTM parameters (e.g., ?utm_source=chatgpt) in shared links."
                : "AI 流量检测依赖于 referrer 数据和 UTM 参数。部分 AI 平台在用户点击链接时可能不会发送 referrer 信息。为获得最佳检测效果，建议在分享链接时添加 UTM 参数（如 ?utm_source=chatgpt）。"}
            </p>
          </div>
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
              <table 
                className={styles.table}
                aria-label={isEnglish ? "Top AI-performing products" : "AI 渠道表现最佳产品"}
              >
                <thead>
                  <tr>
                    <th scope="col">{isEnglish ? "Product" : "产品"}</th>
                    <th scope="col">{isEnglish ? "AI GMV" : "AI GMV"}</th>
                    <th scope="col">{isEnglish ? "AI Orders" : "AI 订单"}</th>
                    <th scope="col">{isEnglish ? "Top Channel" : "主要渠道"}</th>
                    <th scope="col">{isEnglish ? "Content Status" : "信息完整度"}</th>
                    <th scope="col">{isEnglish ? "Improvements" : "改进项"}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.topProducts.map(product => (
                    <tr key={product.productId}>
                      <td className={styles.cellLabel}>
                        <a 
                          href={product.url} 
                          target="_blank" 
                          rel="noopener noreferrer" 
                          className={styles.link}
                        >
                          {product.title}
                        </a>
                      </td>
                      <td>{formatCurrency(product.aiGMV, currency, isEnglish)}</td>
                      <td>{product.aiOrders}</td>
                      <td>{product.topChannel || "-"}</td>
                      <td>
                        <StatusBadge 
                          status={product.schemaMarkupStatus} 
                          isEnglish={isEnglish} 
                        />
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
            <div className={styles.emptyState}>
              <p className={styles.emptyStateTitle}>
                {isEnglish 
                  ? "No AI-attributed orders yet" 
                  : "暂无 AI 渠道订单数据"}
              </p>
              <p className={styles.emptyStateDescription}>
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
            
            {/* 一键复制全部 FAQ */}
            <div className={styles.faqCopyAllWrapper}>
              <CopyButton 
                text={report.suggestedFAQs.map(faq => 
                  `Q: ${faq.question}\nA: ${faq.suggestedAnswer}`
                ).join("\n\n")} 
                isEnglish={isEnglish} 
              />
              <span className={styles.faqCopyAllLabel}>
                {isEnglish ? "Copy all FAQs" : "复制全部 FAQ"}
              </span>
            </div>
            
            <div className={styles.faqList}>
              {report.suggestedFAQs.map((faq) => (
                <div
                  key={`faq-${faq.basedOnProduct}-${faq.question.slice(0, 20)}`}
                  className={styles.faqCard}
                >
                  <div className={styles.faqCopyButton}>
                    <CopyButton 
                      text={`Q: ${faq.question}\nA: ${faq.suggestedAnswer}`} 
                      isEnglish={isEnglish}
                      size="small"
                    />
                  </div>
                  <p className={styles.faqQuestion}>
                    Q: {faq.question}
                  </p>
                  <p className={styles.faqAnswer}>
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
                    background: report.llmsEnhancements.currentCoverage === 0 
                      ? "#e0e0e0" // 0% 时保持灰色，警告信息已在下方显示
                      : report.llmsEnhancements.currentCoverage < 50 
                        ? "#f4a623" 
                        : "#50b83c",
                    transition: "width 0.3s ease, background 0.3s ease",
                  }}
                />
              </div>
              <span style={{ 
                fontWeight: 600,
                color: report.llmsEnhancements.currentCoverage === 0 
                  ? "#de3618" 
                  : report.llmsEnhancements.currentCoverage < 50 
                    ? "#8a6116" 
                    : "#2e7d32",
              }}>
                {report.llmsEnhancements.currentCoverage}%
              </span>
            </div>
            {report.llmsEnhancements.currentCoverage === 0 && (
              <p style={{ 
                margin: "8px 0 0", 
                padding: "8px 12px",
                background: "#fef3f3", 
                borderRadius: 4,
                fontSize: 13, 
                color: "#de3618",
                border: "1px solid #fad1cf",
              }}>
                ⚠️ {isEnglish 
                  ? "No content exposed to AI crawlers. Enable at least one option below to improve AI visibility." 
                  : "当前未向 AI 爬虫暴露任何内容。启用以下至少一个选项以提升 AI 可见性。"}
              </p>
            )}
          </div>
          
          {report.llmsEnhancements.categoryRecommendations.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <strong>{isEnglish ? "Recommended Actions:" : "推荐操作："}</strong>
              <ul style={{ margin: "8px 0", paddingLeft: 20 }}>
                {report.llmsEnhancements.categoryRecommendations.map((rec, i) => (
                  <li key={i} style={{ marginBottom: 4, color: "#555" }}>{rec}</li>
                ))}
              </ul>
            </div>
          )}
          
          {report.llmsEnhancements.currentCoverage === 100 && (
            <p style={{ 
              margin: "0 0 16px", 
              padding: "8px 12px",
              background: "#e6f7ed", 
              borderRadius: 4,
              fontSize: 13, 
              color: "#2e7d32",
              border: "1px solid #b7e4c7",
            }}>
              ✓ {isEnglish 
                ? "All content types are enabled. Your store is fully optimized for AI crawling." 
                : "所有内容类型已启用，您的店铺已完全优化以供 AI 抓取。"}
            </p>
          )}
          
          <Link to={workspaceLlmsHref} className={styles.primaryButton}>
            {isEnglish ? "Open llms.txt Workspace" : "打开 llms.txt 工作台"}
          </Link>
        </div>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
