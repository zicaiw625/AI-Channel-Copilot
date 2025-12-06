/**
 * KPI Cards 组件
 * 显示核心指标卡片：总 GMV、AI GMV、AI 订单数、AI 新客数
 */

import { t } from "../../lib/i18n";
import type { DashboardOverview, FormatHelpers, Lang } from "./types";
import styles from "../../styles/app.dashboard.module.css";

interface KPICardsProps {
  overview: DashboardOverview;
  lang: Lang;
  formatters: FormatHelpers;
}

export function KPICards({ overview, lang, formatters }: KPICardsProps) {
  const { fmtCurrency, fmtNumber, fmtPercent } = formatters;
  const uiLanguage = lang;

  return (
    <div className={styles.kpiGrid}>
      <div className={styles.card}>
        <p className={styles.cardLabel}>{t(lang, "kpi_total_gmv")}</p>
        <p className={styles.cardValue}>{fmtCurrency(overview.totalGMV)}</p>
        <p className={styles.cardMeta}>
          {uiLanguage === "English" ? "Orders" : t(lang, "kpi_orders")} {fmtNumber(overview.totalOrders)} · {uiLanguage === "English" ? "New" : t(lang, "kpi_new_customers")} {fmtNumber(overview.totalNewCustomers)}
        </p>
        <p className={styles.helpText}>{t(lang, "kpi_net_gmv")} {fmtCurrency(overview.netGMV)}</p>
      </div>
      
      <div className={styles.card}>
        <p className={styles.cardLabel}>{t(lang, "kpi_ai_gmv")}</p>
        <p className={styles.cardValue}>{fmtCurrency(overview.aiGMV)}</p>
        <p className={styles.cardMeta}>{uiLanguage === "English" ? "Share" : t(lang, "kpi_ai_share")} {fmtPercent(overview.aiShare)}</p>
        <p className={styles.helpText}>{uiLanguage === "English" ? "AI Net GMV" : "AI 净 GMV"} {fmtCurrency(overview.netAiGMV)}</p>
      </div>
      
      <div className={styles.card}>
        <p className={styles.cardLabel}>{t(lang, "kpi_ai_orders")}</p>
        <p className={styles.cardValue}>{fmtNumber(overview.aiOrders)}</p>
        <p className={styles.cardMeta}>
          {uiLanguage === "English" ? "Total Orders" : t(lang, "kpi_ai_order_share")} {fmtNumber(overview.totalOrders)} · {fmtPercent(overview.aiOrderShare)}
        </p>
      </div>
      
      <div className={styles.card}>
        <p className={styles.cardLabel}>{t(lang, "kpi_ai_new_customers")}</p>
        <p className={styles.cardValue}>{fmtNumber(overview.aiNewCustomers)}</p>
        <p className={styles.cardMeta}>
          {uiLanguage === "English" ? "AI New Customer Rate" : t(lang, "kpi_ai_new_customer_rate")} {fmtPercent(overview.aiNewCustomerRate)} · {uiLanguage === "English" ? "Site New" : "全站新客"} {fmtNumber(overview.totalNewCustomers)}
        </p>
      </div>
    </div>
  );
}
