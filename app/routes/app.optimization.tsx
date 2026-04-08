import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData, useLocation, useNavigate, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { CopyButton, OptimizationStatusBadge, ScoreGauge, SuggestionCard, formatOptimizationCurrency } from "../components/optimization/OptimizationPanels";
import { authenticate } from "../shopify.server";
import { getSettings } from "../lib/settings.server";
import { generateAIOptimizationReport } from "../lib/aiOptimization.server";
import { useUILanguage } from "../lib/useUILanguage";
import { requireEnv } from "../lib/env.server";
import { buildAiVisibilityHref, buildFunnelHref, buildOptimizationBackHref, getPreservedSearchParams, parseBackTo, parseWorkspaceTab } from "../lib/navigation";
import { resolveUILanguageFromRequest } from "../lib/language.server";
import styles from "../styles/app.dashboard.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticate.admin(request);
  if (auth instanceof Response) throw auth;
  const { admin, session } = auth;

  const shopDomain = session.shop;
  const settings = await getSettings(shopDomain);
  const language = resolveUILanguageFromRequest(request, settings.languages?.[0] || "中文");
  
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

export default function AIOptimization() {
  const { report, language, shopDomain: _shopDomain, currency } = useLoaderData<typeof loader>();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  
  const uiLanguage = useUILanguage(language);
  const searchParamsRef = useRef(searchParams);
  const navigateRef = useRef(navigate);
  
  useEffect(() => {
    searchParamsRef.current = searchParams;
    navigateRef.current = navigate;
  }, [searchParams, navigate]);
  
  useEffect(() => {
    if (uiLanguage !== language) {
      const next = getPreservedSearchParams(searchParamsRef.current);
      next.delete("lang");
      document.cookie = `aicc_language=${encodeURIComponent(uiLanguage)};path=/;max-age=31536000;SameSite=Lax`;
      navigateRef.current(
        {
          pathname: "/app/optimization",
          search: next.toString() ? `?${next.toString()}` : "",
        },
        { replace: true },
      );
    }
  }, [uiLanguage, language]);
  
  // 使用后端返回的语言来保证 UI 和数据内容一致
  const isEnglish = language === "English";
  const backTo = parseBackTo(searchParams.get("backTo"));
  const workspaceTab = parseWorkspaceTab(searchParams.get("fromTab"), "llms");
  const funnelHref = buildFunnelHref(location.search, {
    backTo: "optimization",
    fromTab: workspaceTab,
    optimizationBackTo: backTo,
  });
  const backHref = buildOptimizationBackHref(location.search);
  const workspaceLlmsHref = buildAiVisibilityHref(location.search, { tab: workspaceTab, fromTab: null, backTo: null });
  const backLabel = backTo === "dashboard"
    ? (isEnglish ? "Back to Dashboard" : "返回仪表盘")
    : (isEnglish ? "Back to Visibility Tools" : "返回可选增长工具");
  
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
        <div style={{ marginBottom: 16 }}>
          <Link to={backHref} className={styles.secondaryButton}>
            ← {backLabel}
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

          <div style={{ marginTop: 16 }}>
            <Link to={funnelHref} className={styles.secondaryButton}>
              {isEnglish ? "View Funnel Analysis" : "查看漏斗分析"}
            </Link>
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
                      <td>{formatOptimizationCurrency(product.aiGMV, currency, isEnglish)}</td>
                      <td>{product.aiOrders}</td>
                      <td>{product.topChannel || "-"}</td>
                      <td>
                        <OptimizationStatusBadge 
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
              {report.suggestedFAQs.map((faq, idx) => (
                <div
                  // 使用 idx 避免基于 question 前缀截断导致的 key 碰撞/重排错位
                  key={`faq-${idx}`}
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
                ? "All content types are enabled. Your store is well prepared for AI crawling." 
                : "所有内容类型已启用，您的店铺已为 AI 抓取做好较充分准备。"}
            </p>
          )}
          
          <Link to={workspaceLlmsHref} className={styles.primaryButton}>
            {isEnglish ? "Open Visibility Tools" : "打开可选增长工具"}
          </Link>
        </div>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
