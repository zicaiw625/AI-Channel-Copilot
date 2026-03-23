import type { CSSProperties, ReactNode } from "react";

import { Card } from "./Card";

export interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  dashed?: boolean;
  style?: CSSProperties;
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  dashed = false,
  style,
}: EmptyStateProps) {
  return (
    <Card
      padding="loose"
      style={{
        textAlign: "center",
        background: "#f9fafb",
        border: dashed ? "2px dashed #c4cdd5" : "1px solid #e1e3e5",
        ...style,
      }}
    >
      {icon && <div style={{ fontSize: 48, marginBottom: 16 }}>{icon}</div>}
      <h3 style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 600, color: "#212b36" }}>{title}</h3>
      {description && (
        <p style={{ margin: "0 0 16px", fontSize: 14, color: "#637381", lineHeight: 1.6 }}>
          {description}
        </p>
      )}
      {action}
    </Card>
  );
}
