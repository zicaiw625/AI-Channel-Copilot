/**
 * Button 组件
 * 统一的按钮样式，风格接近 Shopify Polaris Button
 */

import type { ReactNode, CSSProperties, MouseEventHandler } from "react";

export type ButtonVariant = "primary" | "secondary" | "plain" | "destructive";

export interface ButtonProps {
  variant?: ButtonVariant;
  size?: "small" | "medium" | "large";
  fullWidth?: boolean;
  loading?: boolean;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  onClick?: MouseEventHandler<HTMLButtonElement>;
  style?: CSSProperties;
  className?: string;
  children: ReactNode;
}

const variantStyles: Record<ButtonVariant, {
  bg: string;
  bgHover: string;
  color: string;
  border: string;
}> = {
  primary: {
    bg: "#008060",
    bgHover: "#006e52",
    color: "#fff",
    border: "none",
  },
  secondary: {
    bg: "#fff",
    bgHover: "#f9fafb",
    color: "#212b36",
    border: "1px solid #babfc3",
  },
  plain: {
    bg: "transparent",
    bgHover: "#f4f6f8",
    color: "#006fbb",
    border: "none",
  },
  destructive: {
    bg: "#d72c0d",
    bgHover: "#b52a10",
    color: "#fff",
    border: "none",
  },
};

const sizeStyles = {
  small: { padding: "6px 12px", fontSize: 13 },
  medium: { padding: "10px 16px", fontSize: 14 },
  large: { padding: "12px 24px", fontSize: 16 },
};

export function Button({
  variant = "secondary",
  size = "medium",
  fullWidth = false,
  loading = false,
  disabled,
  type = "button",
  onClick,
  style,
  className,
  children,
}: ButtonProps) {
  const variantStyle = variantStyles[variant];
  const sizeStyle = sizeStyles[size];

  return (
    <button
      type={type}
      disabled={disabled || loading}
      onClick={onClick}
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        ...sizeStyle,
        width: fullWidth ? "100%" : undefined,
        background: variantStyle.bg,
        color: variantStyle.color,
        border: variantStyle.border,
        borderRadius: 4,
        fontWeight: 500,
        cursor: disabled || loading ? "not-allowed" : "pointer",
        opacity: disabled || loading ? 0.6 : 1,
        transition: "background 0.15s ease",
        textDecoration: "none",
        ...style,
      }}
    >
      {loading && (
        <span
          style={{
            width: 14,
            height: 14,
            border: "2px solid currentColor",
            borderTopColor: "transparent",
            borderRadius: "50%",
            animation: "spin 0.8s linear infinite",
          }}
        />
      )}
      {children}
    </button>
  );
}
