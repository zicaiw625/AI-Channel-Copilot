/**
 * Trend Chart 组件
 * 显示 GMV/订单数的趋势图
 */

import { useState, useMemo, useCallback } from "react";
import { t } from "../../lib/i18n";
import { channelList } from "../../lib/aiData";
import type { TrendPoint, TrendScope, FormatHelpers, Lang } from "./types";
import styles from "../../styles/app.dashboard.module.css";

interface TrendChartProps {
  trend: TrendPoint[];
  lang: Lang;
  formatters: FormatHelpers;
}

type TrendMetric = "gmv" | "orders";

export function TrendChart({ trend, lang, formatters }: TrendChartProps) {
  const [trendMetric, setTrendMetric] = useState<TrendMetric>("gmv");
  const [trendScope, setTrendScope] = useState<TrendScope>("ai");
  const { fmtCurrency, fmtNumber } = formatters;
  const uiLanguage = lang;

  const trendScopes = useMemo(
    () => [
      { key: "overall" as TrendScope, label: uiLanguage === "English" ? "All Orders" : "全部订单" },
      { key: "ai" as TrendScope, label: uiLanguage === "English" ? "AI Summary" : "AI 汇总" },
      ...channelList.map((channel) => ({ key: channel as TrendScope, label: channel })),
    ],
    [uiLanguage],
  );

  const getTrendValue = useCallback(
    (point: TrendPoint) => {
      if (trendScope === "overall") {
        return trendMetric === "gmv" ? point.overallGMV : point.overallOrders;
      }
      if (trendScope === "ai") {
        return trendMetric === "gmv" ? point.aiGMV : point.aiOrders;
      }
      const channelMetrics = point.byChannel[trendScope];
      if (!channelMetrics) return 0;
      return trendMetric === "gmv" ? channelMetrics.gmv : channelMetrics.orders;
    },
    [trendMetric, trendScope],
  );

  const trendScopeLabel =
    trendScopes.find((item) => item.key === trendScope)?.label || 
    (uiLanguage === "English" ? "AI Summary" : "AI 汇总");

  const trendMax = useMemo(
    () => Math.max(1, ...trend.map((point) => getTrendValue(point))),
    [getTrendValue, trend],
  );

  return (
    <div className={styles.card}>
      <div className={styles.sectionHeader}>
        <div>
          <p className={styles.sectionLabel}>{uiLanguage === "English" ? "Trend" : "趋势"}</p>
          <h3 className={styles.sectionTitle}>{t(lang, "trend_section_title")}</h3>
        </div>
        <div className={styles.trendControls}>
          <div className={styles.toggleGroup}>
            {[
              { key: "gmv" as TrendMetric, label: "GMV" },
              { key: "orders" as TrendMetric, label: uiLanguage === "English" ? "Orders" : "订单" },
            ].map(({ key, label }) => (
              <button
                key={key}
                className={`${styles.toggle} ${trendMetric === key ? styles.toggleActive : ""}`}
                onClick={() => setTrendMetric(key)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
          <div className={styles.trendFilterGroup}>
            {trendScopes.map((scope) => (
              <button
                key={scope.key}
                className={`${styles.toggle} ${trendScope === scope.key ? styles.toggleActive : ""}`}
                onClick={() => setTrendScope(scope.key)}
                type="button"
              >
                {scope.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      
      <div className={styles.legend}>
        <span className={styles.legendDot} />
        <span>
          {trendScopeLabel} · {trendMetric === "gmv" ? "GMV" : (uiLanguage === "English" ? "Orders" : "订单数")}
        </span>
      </div>
      
      <div className={styles.trendList}>
        {trend.map((point) => {
          const value = getTrendValue(point);
          const secondary =
            trendScope === "overall"
              ? trendMetric === "gmv"
                ? (uiLanguage === "English" ? `AI GMV ${fmtCurrency(point.aiGMV)}` : `AI GMV ${fmtCurrency(point.aiGMV)}`)
                : (uiLanguage === "English" ? `AI Orders ${fmtNumber(point.aiOrders)}` : `AI 订单 ${fmtNumber(point.aiOrders)}`)
              : trendMetric === "gmv"
                ? (uiLanguage === "English" ? `Total GMV ${fmtCurrency(point.overallGMV)}` : `总 GMV ${fmtCurrency(point.overallGMV)}`)
                : (uiLanguage === "English" ? `Total Orders ${fmtNumber(point.overallOrders)}` : `总订单 ${fmtNumber(point.overallOrders)}`);

          return (
            <div key={point.label} className={styles.trendRow}>
              <div className={styles.trendLabel}>{point.label}</div>
              <div className={styles.trendBarBlock}>
                <div className={styles.trendBar}>
                  <div
                    className={styles.trendFill}
                    style={{ width: `${(value / trendMax) * 100}%` }}
                  />
                </div>
                <div className={styles.trendMeta}>
                  <span>{trendMetric === "gmv" ? fmtCurrency(value) : fmtNumber(value)}</span>
                  <span>{secondary}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      
      <p className={styles.helpText}>
        {uiLanguage === "English" 
          ? "Toggle GMV/Orders and filter by channel. Low sample sizes can exaggerate variance; read alongside channel details." 
          : "可切换 GMV / 订单并按渠道过滤；样本量低时单笔订单会放大波动，解读时需结合渠道详情。"}
      </p>
    </div>
  );
}
