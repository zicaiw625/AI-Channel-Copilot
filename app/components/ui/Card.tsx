/**
 * Card 组件
 * 通用卡片容器，风格接近 Shopify Polaris Card
 */

import type { ReactNode, CSSProperties } from "react";

export interface CardProps {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  padding?: "none" | "tight" | "normal" | "loose";
  sectioned?: boolean;
  style?: CSSProperties;
}

const paddingMap = {
  none: 0,
  tight: 12,
  normal: 20,
  loose: 32,
};

export function Card({
  children,
  title,
  subtitle,
  padding = "normal",
  sectioned = false,
  style,
}: CardProps) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e1e3e5",
        borderRadius: 8,
        boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
        ...style,
      }}
    >
      {(title || subtitle) && (
        <div
          style={{
            padding: "16px 20px",
            borderBottom: sectioned ? "1px solid #e1e3e5" : undefined,
          }}
        >
          {title && (
            <h3
              style={{
                margin: 0,
                fontSize: 16,
                fontWeight: 600,
                color: "#212b36",
              }}
            >
              {title}
            </h3>
          )}
          {subtitle && (
            <p
              style={{
                margin: "4px 0 0",
                fontSize: 13,
                color: "#637381",
              }}
            >
              {subtitle}
            </p>
          )}
        </div>
      )}
      <div style={{ padding: paddingMap[padding] }}>{children}</div>
    </div>
  );
}
