import type { CSSProperties, ReactNode } from "react";

import { Card } from "./Card";

export interface InfoCardProps {
  title: string;
  description: ReactNode;
  icon?: ReactNode;
  accentColor?: string;
  background?: string;
  footer?: ReactNode;
  style?: CSSProperties;
}

export function InfoCard({
  title,
  description,
  icon,
  accentColor = "#008060",
  background = "#f9fafb",
  footer,
  style,
}: InfoCardProps) {
  return (
    <Card
      padding="tight"
      style={{
        background,
        borderLeft: `4px solid ${accentColor}`,
        ...style,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        {icon && <span style={{ fontSize: 20 }}>{icon}</span>}
        <span style={{ fontWeight: 600, color: accentColor }}>{title}</span>
      </div>
      <div style={{ fontSize: 13, color: "#637381", lineHeight: 1.5 }}>{description}</div>
      {footer && <div style={{ marginTop: 12 }}>{footer}</div>}
    </Card>
  );
}
