/**
 * KPI Cards 组件
 * 显示核心指标卡片：总 GMV、AI GMV、AI 订单数、AI 新客数
 * 
 * 低样本量时弱化 AI 相关指标的展示，提示用户数据不足
 */

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
    </>
  );
}
