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

  const trendScopes = useMemo(
    () => [
      { key: "overall" as TrendScope, label: t(lang, "all_orders") },
      { key: "ai" as TrendScope, label: t(lang, "ai_summary") },
      ...channelList.map((channel) => ({ key: channel as TrendScope, label: channel })),
    ],
    [lang],
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
    t(lang, "ai_summary");

  const trendMax = useMemo(
    () => Math.max(1, ...trend.map((point) => getTrendValue(point))),
    [getTrendValue, trend],
  );

  return (
    <div className={styles.card}>
      <div className={styles.sectionHeader}>
        <div>
          <p className={styles.sectionLabel}>{t(lang, "trend_label")}</p>
          <h3 className={styles.sectionTitle}>{t(lang, "trend_section_title")}</h3>
        </div>
        <div className={styles.trendControls}>
          <div className={styles.toggleGroup}>
            {[
              { key: "gmv" as TrendMetric, label: "GMV" },
              { key: "orders" as TrendMetric, label: t(lang, "toggle_orders") },
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
          {trendScopeLabel} · {trendMetric === "gmv" ? "GMV" : t(lang, "col_orders")}
        </span>
      </div>
      
      <div className={styles.trendList}>
        {trend.map((point) => {
          const value = getTrendValue(point);
          const secondary =
            trendScope === "overall"
              ? trendMetric === "gmv"
                ? `${t(lang, "kpi_ai_gmv")} ${fmtCurrency(point.aiGMV)}`
                : `${t(lang, "kpi_ai_orders")} ${fmtNumber(point.aiOrders)}`
              : trendMetric === "gmv"
                ? `${t(lang, "total_gmv")} ${fmtCurrency(point.overallGMV)}`
                : `${t(lang, "total_orders")} ${fmtNumber(point.overallOrders)}`;

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
        {t(lang, "trend_help_text")}
      </p>
    </div>
  );
}
