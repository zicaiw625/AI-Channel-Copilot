/**
 * KPI Cards 组件
 * 显示核心指标卡片：总 GMV、AI GMV、AI 订单数、AI 新客数
 * 
 * 低样本量时弱化 AI 相关指标的展示，提示用户数据不足
 */

import { Link } from "react-router";
import { t } from "../../lib/i18n";
import type { DashboardOverview, FormatHelpers, Lang } from "./types";
import styles from "../../styles/app.dashboard.module.css";

// 低样本量阈值
const LOW_SAMPLE_THRESHOLD = 10;
const VERY_LOW_SAMPLE_THRESHOLD = 3;

interface KPICardsProps {
  overview: DashboardOverview;
  lang: Lang;
  formatters: FormatHelpers;
}

/**
 * 低样本量提示组件
 */
const LowSampleBadge = ({ lang, level }: { lang: Lang; level: "low" | "very_low" }) => {
  const isEnglish = lang === "English";
  const isVeryLow = level === "very_low";
  
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 6px",
        fontSize: 10,
        fontWeight: 500,
        color: isVeryLow ? "#cf1322" : "#d46b08",
        background: isVeryLow ? "#fff1f0" : "#fff7e6",
        border: `1px solid ${isVeryLow ? "#ffa39e" : "#ffd591"}`,
        borderRadius: 4,
        marginLeft: 6,
      }}
      title={isEnglish 
        ? (isVeryLow ? "Very few AI orders. Data is not statistically reliable." : "Sample size is small. Metrics are for reference only.")
        : (isVeryLow ? "AI 订单极少，数据不具统计意义" : "样本量较小，指标仅供参考")}
    >
      {isVeryLow ? "⚠️" : "📊"}
      {isEnglish 
        ? (isVeryLow ? "Very Low Sample" : "Low Sample")
        : (isVeryLow ? "样本极少" : "样本少")}
    </span>
  );
};

/**
 * 数据收集提示
 */
const DataCollectionHint = ({ lang, aiOrders }: { lang: Lang; aiOrders: number }) => {
  const isEnglish = lang === "English";
  
  if (aiOrders >= LOW_SAMPLE_THRESHOLD) return null;
  
  return (
    <div
      style={{
        marginTop: 16,
        padding: "12px 16px",
        background: aiOrders < VERY_LOW_SAMPLE_THRESHOLD ? "#fff1f0" : "#fffbe6",
        border: `1px solid ${aiOrders < VERY_LOW_SAMPLE_THRESHOLD ? "#ffccc7" : "#ffe58f"}`,
        borderRadius: 8,
        fontSize: 13,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <span style={{ fontSize: 18 }}>{aiOrders < VERY_LOW_SAMPLE_THRESHOLD ? "📈" : "💡"}</span>
        <div>
          <div style={{ fontWeight: 600, marginBottom: 4, color: "#333" }}>
            {isEnglish 
              ? (aiOrders === 0 
                  ? "No AI orders detected yet" 
                  : `Only ${aiOrders} AI order${aiOrders === 1 ? "" : "s"} detected`)
              : (aiOrders === 0 
                  ? "尚未检测到 AI 渠道订单" 
                  : `仅检测到 ${aiOrders} 笔 AI 订单`)}
          </div>
          <p style={{ margin: 0, color: "#666", lineHeight: 1.5 }}>
            {isEnglish
              ? "AI channel metrics require more data to be meaningful. This could be because: 1) AI traffic is still building up, 2) Referrer/UTM rules need adjustment, or 3) The time range is too short."
              : "AI 渠道指标需要更多数据才具有参考价值。可能原因：1) AI 流量正在积累中，2) Referrer/UTM 规则需要调整，3) 时间范围过短。"}
          </p>
          {aiOrders === 0 && (
            <p style={{ margin: "8px 0 0", fontSize: 12, color: "#888" }}>
              {isEnglish
                ? "Try extending the date range or checking your attribution rules in Settings."
                : "建议延长时间范围或在「设置」中检查归因规则。"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export function KPICards({ overview, lang, formatters }: KPICardsProps) {
  const { fmtCurrency, fmtNumber, fmtPercent } = formatters;
  const uiLanguage = lang;
  
  const aiOrders = overview.aiOrders;
  const isLowSample = aiOrders < LOW_SAMPLE_THRESHOLD;
  const isVeryLowSample = aiOrders < VERY_LOW_SAMPLE_THRESHOLD;
  
  // 低样本量时的弱化样式
  const lowSampleStyle = isLowSample ? {
    opacity: isVeryLowSample ? 0.6 : 0.8,
  } : {};

  return (
    <>
      <div className={styles.kpiGrid}>
        {/* 总 GMV 卡片 - 不受低样本量影响 */}
        <div className={styles.card}>
          <p className={styles.cardLabel}>{t(lang, "kpi_total_gmv")}</p>
          <p className={styles.cardValue}>{fmtCurrency(overview.totalGMV)}</p>
          <p className={styles.cardMeta}>
            {uiLanguage === "English" ? "Orders" : t(lang, "kpi_orders")} {fmtNumber(overview.totalOrders)} · {uiLanguage === "English" ? "New" : t(lang, "kpi_new_customers")} {fmtNumber(overview.totalNewCustomers)}
          </p>
          <p className={styles.helpText}>{t(lang, "kpi_net_gmv")} {fmtCurrency(overview.netGMV)}</p>
        </div>
        
        {/* AI GMV 卡片 - 低样本量时弱化 */}
        <div className={styles.card} style={{ ...lowSampleStyle, border: isLowSample ? "1px dashed #d9d9d9" : undefined }}>
          <p className={styles.cardLabel}>
            {t(lang, "kpi_ai_gmv")}
            {isLowSample && <LowSampleBadge lang={lang} level={isVeryLowSample ? "very_low" : "low"} />}
          </p>
          <p className={styles.cardValue}>
            {isVeryLowSample && aiOrders === 0 ? (
              <span style={{ fontSize: 18, color: "#bfbfbf" }}>
                {uiLanguage === "English" ? "Awaiting data" : "等待数据"}
              </span>
            ) : (
              fmtCurrency(overview.aiGMV)
            )}
          </p>
          <p className={styles.cardMeta}>
            {uiLanguage === "English" ? "Share" : t(lang, "kpi_ai_share")} {fmtPercent(overview.aiShare)}
          </p>
          <p className={styles.helpText}>
            {uiLanguage === "English" ? "AI Net GMV" : "AI 净 GMV"} {fmtCurrency(overview.netAiGMV)}
          </p>
        </div>
        
        {/* AI 订单数卡片 - 低样本量时弱化 */}
        <div className={styles.card} style={{ ...lowSampleStyle, border: isLowSample ? "1px dashed #d9d9d9" : undefined }}>
          <p className={styles.cardLabel}>
            {t(lang, "kpi_ai_orders")}
            {isLowSample && <LowSampleBadge lang={lang} level={isVeryLowSample ? "very_low" : "low"} />}
          </p>
          <p className={styles.cardValue}>
            {aiOrders === 0 ? (
              <span style={{ fontSize: 18, color: "#bfbfbf" }}>0</span>
            ) : (
              fmtNumber(overview.aiOrders)
            )}
          </p>
          <p className={styles.cardMeta}>
            {uiLanguage === "English" ? "Total Orders" : t(lang, "kpi_ai_order_share")} {fmtNumber(overview.totalOrders)} · {fmtPercent(overview.aiOrderShare)}
          </p>
        </div>
        
        {/* AI 新客数卡片 - 低样本量时弱化 */}
        <div className={styles.card} style={{ ...lowSampleStyle, border: isLowSample ? "1px dashed #d9d9d9" : undefined }}>
          <p className={styles.cardLabel}>
            {t(lang, "kpi_ai_new_customers")}
            {isLowSample && <LowSampleBadge lang={lang} level={isVeryLowSample ? "very_low" : "low"} />}
          </p>
          <p className={styles.cardValue}>
            {overview.aiNewCustomers === 0 ? (
              <span style={{ fontSize: 18, color: "#bfbfbf" }}>0</span>
            ) : (
              fmtNumber(overview.aiNewCustomers)
            )}
          </p>
          <p className={styles.cardMeta}>
            {uiLanguage === "English" ? "AI New Customer Rate" : t(lang, "kpi_ai_new_customer_rate")} {fmtPercent(overview.aiNewCustomerRate)} · {uiLanguage === "English" ? "Site New" : "全站新客"} {fmtNumber(overview.totalNewCustomers)}
          </p>
        </div>
      </div>
      
      {/* 低样本量数据收集提示 */}
      <DataCollectionHint lang={lang} aiOrders={aiOrders} />
      
      {/* 可检测覆盖率提示 */}
      <DetectionCoverageCard overview={overview} lang={lang} formatters={formatters} />
    </>
  );
}

/**
 * 可检测覆盖率卡片
 * 显示有多少订单可以被检测到来源，并引导用户使用 UTM 向导
 */
function DetectionCoverageCard({ 
  overview, 
  lang, 
  formatters 
}: { 
  overview: DashboardOverview; 
  lang: Lang; 
  formatters: FormatHelpers;
}) {
  const { fmtPercent, fmtNumber } = formatters;
  const isEnglish = lang === "English";
  
  const coverage = overview.detectionCoverage ?? 0;
  const utmCoverage = overview.utmCoverage ?? 0;
  const referrerCoverage = overview.referrerCoverage ?? 0;
  const totalOrders = overview.totalOrders;
  
  // 如果没有订单数据，不显示
  if (totalOrders === 0) return null;
  
  // 确定覆盖率状态
  const isLowCoverage = coverage < 0.3;
  const isMediumCoverage = coverage >= 0.3 && coverage < 0.7;
  const isHighCoverage = coverage >= 0.7;
  
  const statusColor = isLowCoverage ? "#de3618" : isMediumCoverage ? "#f4a623" : "#50b83c";
  const statusBg = isLowCoverage ? "#fef3f3" : isMediumCoverage ? "#fffbe6" : "#f6ffed";
  const statusBorder = isLowCoverage ? "#ffccc7" : isMediumCoverage ? "#ffe58f" : "#b7eb8f";
  
  return (
    <div
      style={{
        marginTop: 16,
        padding: "16px 20px",
        background: statusBg,
        border: `1px solid ${statusBorder}`,
        borderRadius: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <span style={{ fontSize: 20 }}>
              {isLowCoverage ? "⚠️" : isMediumCoverage ? "📊" : "✅"}
            </span>
            <div>
              <span style={{ fontWeight: 600, color: "#212b36", fontSize: 15 }}>
                {isEnglish ? "AI Detection Coverage" : "AI 检测覆盖率"}
              </span>
              <span style={{ 
                marginLeft: 8,
                padding: "2px 8px",
                background: statusColor,
                color: "#fff",
                borderRadius: 4,
                fontSize: 12,
                fontWeight: 600,
              }}>
                {fmtPercent(coverage)}
              </span>
            </div>
          </div>
          
          <p style={{ margin: "0 0 12px", color: "#637381", fontSize: 13, lineHeight: 1.5 }}>
            {isEnglish
              ? `${fmtNumber(overview.detectableOrders ?? 0)} of ${fmtNumber(totalOrders)} orders have referrer or UTM data for AI attribution.`
              : `${fmtNumber(overview.detectableOrders ?? 0)} / ${fmtNumber(totalOrders)} 笔订单有 referrer 或 UTM 数据可用于 AI 归因。`}
            {isLowCoverage && (
              <strong style={{ color: statusColor }}>
                {" "}
                {isEnglish 
                  ? "Low coverage means AI traffic may be underreported." 
                  : "覆盖率过低意味着 AI 流量可能被低估。"}
              </strong>
            )}
            {isHighCoverage && (
              <strong style={{ color: statusColor }}>
                {" "}
                {isEnglish 
                  ? "Excellent coverage! AI attribution data is reliable." 
                  : "覆盖率优秀！AI 归因数据可靠。"}
              </strong>
            )}
          </p>
          
          {/* 覆盖率细分 */}
          <div style={{ display: "flex", gap: 16, marginBottom: 12 }}>
            <div style={{ 
              display: "flex", 
              alignItems: "center", 
              gap: 6,
              padding: "4px 10px",
              background: "rgba(255,255,255,0.8)",
              borderRadius: 4,
              fontSize: 12,
            }}>
              <span style={{ color: "#635bff" }}>🔗</span>
              <span>UTM: <strong>{fmtPercent(utmCoverage)}</strong></span>
            </div>
            <div style={{ 
              display: "flex", 
              alignItems: "center", 
              gap: 6,
              padding: "4px 10px",
              background: "rgba(255,255,255,0.8)",
              borderRadius: 4,
              fontSize: 12,
            }}>
              <span style={{ color: "#00a2ff" }}>🌐</span>
              <span>Referrer: <strong>{fmtPercent(referrerCoverage)}</strong></span>
            </div>
          </div>
          
          {isLowCoverage && (
            <p style={{ margin: 0, fontSize: 12, color: "#666" }}>
              {isEnglish
                ? "💡 Tip: Use the UTM Setup Wizard to generate trackable links for AI assistants."
                : "💡 提示：使用 UTM 设置向导为 AI 助手生成可追踪的链接。"}
            </p>
          )}
        </div>
        
        {/* 行动按钮 */}
        {isLowCoverage && (
          <Link
            to="/app/utm-wizard"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "10px 16px",
              background: "#008060",
              color: "#fff",
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 600,
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            🔗 {isEnglish ? "Setup UTM Links" : "设置 UTM 链接"}
          </Link>
        )}
      </div>
    </div>
  );
}
