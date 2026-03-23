import type { CSSProperties, ReactNode } from "react";

export type StatusBadgeTone = "success" | "warning" | "critical" | "info" | "neutral";

export interface StatusBadgeProps {
  tone?: StatusBadgeTone;
  children: ReactNode;
  style?: CSSProperties;
}

const toneStyles: Record<StatusBadgeTone, { bg: string; border: string; text: string }> = {
  success: { bg: "#f6ffed", border: "#b7eb8f", text: "#237804" },
  warning: { bg: "#fff7e6", border: "#ffd591", text: "#ad6800" },
  critical: { bg: "#fff1f0", border: "#ffa39e", text: "#cf1322" },
  info: { bg: "#f0f7ff", border: "#91d5ff", text: "#0958d9" },
  neutral: { bg: "#f4f6f8", border: "#d9d9d9", text: "#637381" },
};

export function StatusBadge({
  tone = "neutral",
  children,
  style,
}: StatusBadgeProps) {
  const toneStyle = toneStyles[tone];

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "4px 8px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 500,
        background: toneStyle.bg,
        color: toneStyle.text,
        border: `1px solid ${toneStyle.border}`,
        ...style,
      }}
    >
      {children}
    </span>
  );
}
