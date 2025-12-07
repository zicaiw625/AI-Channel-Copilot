/**
 * Banner 组件
 * 用于显示提示、警告、错误等信息
 * 风格接近 Shopify Polaris Banner
 */

import type { ReactNode } from "react";

export type BannerStatus = "info" | "success" | "warning" | "critical";

export interface BannerProps {
  status: BannerStatus;
  title?: string;
  children: ReactNode;
  onDismiss?: () => void;
}

const statusStyles: Record<BannerStatus, { bg: string; border: string; text: string; icon: string }> = {
  info: {
    bg: "#e6f7ff",
    border: "#91d5ff",
    text: "#0050b3",
    icon: "ℹ️",
  },
  success: {
    bg: "#e6f7ed",
    border: "#95de64",
    text: "#237804",
    icon: "✅",
  },
  warning: {
    bg: "#fff8e5",
    border: "#ffc53d",
    text: "#8a6116",
    icon: "⚠️",
  },
  critical: {
    bg: "#fff2e8",
    border: "#ffbb96",
    text: "#d4380d",
    icon: "❌",
  },
};

export function Banner({ status, title, children, onDismiss }: BannerProps) {
  const styles = statusStyles[status];

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        padding: "12px 16px",
        background: styles.bg,
        border: `1px solid ${styles.border}`,
        borderRadius: 8,
        color: styles.text,
        position: "relative",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <span style={{ fontSize: 16, flexShrink: 0 }} aria-hidden="true">
          {styles.icon}
        </span>
        <div style={{ flex: 1 }}>
          {title && (
            <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 14 }}>
              {title}
            </div>
          )}
          <div style={{ fontSize: 14, lineHeight: 1.5 }}>{children}</div>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            style={{
              background: "none",
              border: "none",
              color: styles.text,
              cursor: "pointer",
              fontSize: 18,
              padding: 0,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}
