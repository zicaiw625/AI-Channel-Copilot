/**
 * PlanCard 组件
 * 计划选择卡片，用于 Onboarding 和 Billing 页面
 */

import type { ReactNode } from "react";

export interface PlanCardProps {
  name: string;
  price: string;
  period?: string;
  description?: string;
  features: string[];
  recommended?: boolean;
  comingSoon?: boolean;
  disabled?: boolean;
  trialLabel?: string;
  buttonLabel: string;
  onSelect?: () => void;
  children?: ReactNode;
  en?: boolean;
}

export function PlanCard({
  name,
  price,
  period,
  description,
  features,
  recommended = false,
  comingSoon = false,
  disabled = false,
  trialLabel,
  buttonLabel,
  onSelect,
  children,
  en = false,
}: PlanCardProps) {
  const isPrimary = recommended && !comingSoon;

  return (
    <div
      style={{
        flex: 1,
        minWidth: 280,
        maxWidth: 340,
        border: recommended ? "2px solid #008060" : "1px solid #e1e3e5",
        borderRadius: 8,
        padding: 24,
        display: "flex",
        flexDirection: "column",
        position: "relative",
        background: recommended ? "#fbfcfd" : "#fff",
        opacity: comingSoon ? 0.8 : 1,
      }}
    >
      {/* 推荐标签 */}
      {recommended && !comingSoon && (
        <div
          style={{
            position: "absolute",
            top: -12,
            left: "50%",
            transform: "translateX(-50%)",
            background: "#008060",
            color: "#fff",
            padding: "2px 10px",
            borderRadius: 12,
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {en ? "RECOMMENDED" : "推荐"}
        </div>
      )}

      {/* Coming Soon 标签 */}
      {comingSoon && (
        <div
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            background: "#faad14",
            color: "#fff",
            padding: "2px 8px",
            borderRadius: 999,
            fontSize: 12,
          }}
        >
          {en ? "Coming Soon" : "即将上线"}
        </div>
      )}

      {/* 计划名称 */}
      <h3 style={{ margin: 0, fontSize: 18, color: "#212b36" }}>{name}</h3>

      {/* 价格 */}
      <div style={{ fontSize: 32, fontWeight: "bold", margin: "12px 0" }}>
        {price}
        {period && (
          <span style={{ fontSize: 14, fontWeight: "normal", color: "#637381" }}>
            &nbsp;/ {period}
          </span>
        )}
      </div>

      {/* 描述 */}
      {description && (
        <p style={{ color: "#637381", minHeight: 40, margin: "0 0 8px" }}>
          {description}
        </p>
      )}

      {/* 功能列表 */}
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: "12px 0",
          flex: 1,
          lineHeight: 1.6,
        }}
      >
        {features.map((feature, idx) => (
          <li key={idx} style={{ marginBottom: 4 }}>
            ✓ {feature}
          </li>
        ))}
      </ul>

      {/* 子元素（通常是 Form） */}
      {children || (
        <button
          type="button"
          onClick={onSelect}
          disabled={disabled || comingSoon}
          style={{
            width: "100%",
            padding: 12,
            background: isPrimary ? "#008060" : "#fff",
            color: isPrimary ? "#fff" : "#212b36",
            border: isPrimary ? "none" : "1px solid #babfc3",
            borderRadius: 4,
            cursor: disabled || comingSoon ? "not-allowed" : "pointer",
            fontWeight: 600,
            boxShadow: isPrimary ? "0 2px 5px rgba(0,0,0,0.1)" : "none",
          }}
        >
          {buttonLabel}
        </button>
      )}

      {/* 试用标签 */}
      {trialLabel && (
        <div
          style={{
            textAlign: "center",
            fontSize: 12,
            color: "#637381",
            marginTop: 8,
          }}
        >
          {trialLabel}
        </div>
      )}
    </div>
  );
}
