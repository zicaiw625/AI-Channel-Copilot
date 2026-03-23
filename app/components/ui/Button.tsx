/**
 * Button 组件
 * 统一的按钮样式，风格接近 Shopify Polaris Button
 */

import { useState } from "react";
import type { FocusEventHandler, MouseEventHandler, ReactNode, CSSProperties } from "react";

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
  bgActive: string;
  color: string;
  border: string;
  focusRing: string;
}> = {
  primary: {
    bg: "#008060",
    bgHover: "#006e52",
    bgActive: "#005844",
    color: "#fff",
    border: "none",
    focusRing: "0 0 0 3px rgba(0, 128, 96, 0.2)",
  },
  secondary: {
    bg: "#fff",
    bgHover: "#f9fafb",
    bgActive: "#f1f5f9",
    color: "#212b36",
    border: "1px solid #babfc3",
    focusRing: "0 0 0 3px rgba(99, 115, 129, 0.2)",
  },
  plain: {
    bg: "transparent",
    bgHover: "#f4f6f8",
    bgActive: "#e5e7eb",
    color: "#006fbb",
    border: "none",
    focusRing: "0 0 0 3px rgba(0, 111, 187, 0.18)",
  },
  destructive: {
    bg: "#d72c0d",
    bgHover: "#b52a10",
    bgActive: "#8e1f0d",
    color: "#fff",
    border: "none",
    focusRing: "0 0 0 3px rgba(215, 44, 13, 0.18)",
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
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [isPressed, setIsPressed] = useState(false);
  const isDisabled = disabled || loading;
  const background = isDisabled
    ? variantStyle.bg
    : isPressed
      ? variantStyle.bgActive
      : isHovered
        ? variantStyle.bgHover
        : variantStyle.bg;
  const handleBlur: FocusEventHandler<HTMLButtonElement> = () => {
    setIsFocused(false);
    setIsPressed(false);
  };

  return (
    <button
      type={type}
      disabled={isDisabled}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        setIsHovered(false);
        setIsPressed(false);
      }}
      onFocus={() => setIsFocused(true)}
      onBlur={handleBlur}
      onMouseDown={() => setIsPressed(true)}
      onMouseUp={() => setIsPressed(false)}
      className={className}
      aria-busy={loading || undefined}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        ...sizeStyle,
        width: fullWidth ? "100%" : undefined,
        background,
        color: variantStyle.color,
        border: variantStyle.border,
        borderRadius: 4,
        fontWeight: 500,
        cursor: isDisabled ? "not-allowed" : "pointer",
        opacity: isDisabled ? 0.6 : 1,
        transition: "background 0.15s ease, box-shadow 0.15s ease, transform 0.05s ease",
        textDecoration: "none",
        boxShadow: isFocused ? variantStyle.focusRing : "none",
        transform: isPressed && !isDisabled ? "translateY(1px)" : "translateY(0)",
        ...style,
      }}
    >
      {loading && (
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
          style={{
            width: 14,
            height: 14,
          }}
        >
          <circle
            cx="8"
            cy="8"
            r="6"
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.25"
            strokeWidth="2"
          />
          <path
            d="M14 8a6 6 0 0 0-6-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <animateTransform
              attributeName="transform"
              attributeType="XML"
              type="rotate"
              from="0 8 8"
              to="360 8 8"
              dur="0.8s"
              repeatCount="indefinite"
            />
          </path>
        </svg>
      )}
      {children}
    </button>
  );
}
