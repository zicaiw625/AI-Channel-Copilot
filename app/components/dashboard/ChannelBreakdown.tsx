/**
 * Channel Breakdown 组件
 * 显示各 AI 渠道的 GMV、订单数、新客数分布
 */

import { useState, useMemo } from "react";
import { t } from "../../lib/i18n";
import type { ChannelData, FormatHelpers, Lang } from "./types";
import styles from "../../styles/app.dashboard.module.css";

interface ChannelBreakdownProps {
  channels: ChannelData[];
  lang: Lang;
  formatters: FormatHelpers;
}

type MetricView = "gmv" | "orders" | "newCustomers";

export function ChannelBreakdown({ channels, lang, formatters }: ChannelBreakdownProps) {
  const [metricView, setMetricView] = useState<MetricView>("gmv");
  const { fmtCurrency, fmtNumber } = formatters;
  const uiLanguage = lang;

  const channelMax = useMemo(() => {
    const values = channels.map((channel) => {
      if (metricView === "gmv") return channel.gmv;
      if (metricView === "orders") return channel.orders;
      return channel.newCustomers;
    });
    return Math.max(1, ...values);
  }, [channels, metricView]);

  return (
    <div className={styles.card}>
      <div className={styles.sectionHeader}>
        <div>
          <p className={styles.sectionLabel}>{t(lang, "channels_section_label")}</p>
          <h3 className={styles.sectionTitle}>{t(lang, "channels_section_title")}</h3>
        </div>
        <div className={styles.toggleGroup}>
          {[
            { key: "gmv" as MetricView, label: t(lang, "toggle_gmv") },
            { key: "orders" as MetricView, label: t(lang, "toggle_orders") },
            { key: "newCustomers" as MetricView, label: t(lang, "toggle_new_customers") },
          ].map(({ key, label }) => (
            <button
              key={key}
              className={`${styles.toggle} ${metricView === key ? styles.toggleActive : ""}`}
              onClick={() => setMetricView(key)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      
      <div className={styles.channelList}>
        {channels.map((channel) => {
          const value =
            metricView === "gmv"
              ? channel.gmv
              : metricView === "orders"
                ? channel.orders
                : channel.newCustomers;
          const barWidth = `${(value / channelMax) * 100}%`;
          
          return (
            <div key={channel.channel} className={styles.channelRow}>
              <div className={styles.channelLabel}>
                <span className={styles.channelDot} style={{ background: channel.color }} />
                <span>{channel.channel}</span>
              </div>
              <div className={styles.channelBar}>
                <div
                  className={styles.channelFill}
                  style={{ width: barWidth, background: channel.color }}
                />
              </div>
              <span className={styles.channelValue}>
                {metricView === "gmv" ? fmtCurrency(value) : fmtNumber(value)}
              </span>
            </div>
          );
        })}
      </div>
      
      <p className={styles.helpText}>
        {uiLanguage === "English" 
          ? "Priority: referrer > UTM. AI traffic without referrer/UTM cannot be attributed; results are conservative." 
          : "优先级：referrer > UTM。未带 referrer/UTM 的 AI 流量无法被识别，结果为保守估计。"}
      </p>
    </div>
  );
}
