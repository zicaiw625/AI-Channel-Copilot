import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { Link, useLocation } from "react-router";

import { buildAiVisibilityHref } from "../../lib/navigation";
import type { OptimizationSuggestion } from "../../lib/aiOptimization.server";

const STATUS_CONFIG = {
  complete: {
    bg: "#e6f7ed",
    color: "#2e7d32",
    label: { en: "Complete", zh: "完整" },
  },
  partial: {
    bg: "#fff8e5",
    color: "#8a6116",
    label: { en: "Partial", zh: "部分" },
  },
  missing: {
    bg: "#fef3f3",
    color: "#de3618",
    label: { en: "Missing", zh: "缺失" },
  },
} as const;

export const WORKSPACE_TABS = new Set(["schema", "faq", "llms"]);

export const formatOptimizationCurrency = (amount: number, currency: string, isEnglish: boolean): string => {
  return new Intl.NumberFormat(isEnglish ? "en-US" : "zh-CN", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
};

export const CopyButton = ({
  text,
  isEnglish,
  size = "normal",
}: {
  text: string;
  isEnglish: boolean;
  size?: "small" | "normal";
}) => {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = useCallback(async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (timerRef.current) clearTimeout(timerRef.current);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    }
  }, [text]);

  const padding = size === "small" ? "4px 8px" : "6px 12px";
  const fontSize = size === "small" ? 11 : 12;
  const buttonLabel = copied ? (isEnglish ? "Copied!" : "已复制！") : (isEnglish ? "Copy" : "复制");

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={isEnglish ? "Copy to clipboard" : "复制到剪贴板"}
      aria-live="polite"
      style={{
        padding,
        fontSize,
        fontWeight: 500,
        background: copied ? "#52c41a" : "#fff",
        color: copied ? "#fff" : "#333",
        border: copied ? "1px solid #52c41a" : "1px solid #d9d9d9",
        borderRadius: 4,
        cursor: "pointer",
        transition: "all 0.2s",
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
      }}
    >
      <span aria-hidden="true">{copied ? "✓" : "📋"}</span>
      {buttonLabel}
    </button>
  );
};

export const CodeSnippetBlock = ({
  code,
  isEnglish,
}: {
  code: string;
  isEnglish: boolean;
}) => {
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <strong style={{ fontSize: 14 }}>{isEnglish ? "Code Example:" : "代码示例："}</strong>
        <CopyButton text={code} isEnglish={isEnglish} size="small" />
      </div>
      <pre
        style={{
          background: "#f4f6f8",
          padding: 12,
          borderRadius: 4,
          overflow: "auto",
          fontSize: 12,
          margin: 0,
          position: "relative",
        }}
      >
        {code}
      </pre>
      <p
        style={{
          margin: "8px 0 0",
          fontSize: 11,
          color: "#888",
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        💡 {isEnglish ? "Copy this code and add it to your theme or product pages." : "复制此代码并添加到您的主题或产品页面中。"}
      </p>
    </div>
  );
};

export const ScoreGauge = ({ score, label, id }: { score: number; label: string; id: string }) => {
  const color = score >= 70 ? "#50b83c" : score >= 40 ? "#f4a623" : "#de3618";
  const circumference = 2 * Math.PI * 45;
  const offset = circumference - (score / 100) * circumference;
  const gaugeId = `gauge-${id}`;

  return (
    <div style={{ textAlign: "center" }}>
      <svg width="120" height="120" viewBox="0 0 120 120" role="img" aria-labelledby={gaugeId}>
        <title id={gaugeId}>{label}: {score}/100</title>
        <circle cx="60" cy="60" r="45" fill="none" stroke="#e0e0e0" strokeWidth="10" />
        <circle
          cx="60"
          cy="60"
          r="45"
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 60 60)"
          style={{ transition: "stroke-dashoffset 0.5s ease" }}
        />
        <text x="60" y="60" textAnchor="middle" dominantBaseline="middle" fontSize="24" fontWeight="bold" fill={color} aria-hidden="true">
          {score}
        </text>
      </svg>
      <p style={{ marginTop: 8, fontSize: 14, color: "#637381" }}>{label}</p>
    </div>
  );
};

export const SuggestionCard = ({
  suggestion,
  language,
  expanded,
  onToggle,
}: {
  suggestion: OptimizationSuggestion;
  language: string;
  expanded: boolean;
  onToggle: () => void;
}) => {
  const location = useLocation();
  const isEnglish = language === "English";
  const priorityColors = {
    high: { bg: "#fef3f3", border: "#de3618", text: "#de3618" },
    medium: { bg: "#fff8e5", border: "#f4a623", text: "#8a6116" },
    low: { bg: "#f0f8f4", border: "#50b83c", text: "#2e7d32" },
  };
  const colors = priorityColors[suggestion.priority];

  const categoryLabels: Record<string, { en: string; zh: string }> = {
    schema_markup: { en: "Schema Markup", zh: "结构化标记" },
    content_quality: { en: "Content Quality", zh: "内容质量" },
    faq_coverage: { en: "FAQ Coverage", zh: "FAQ 覆盖" },
    product_info: { en: "Product Info", zh: "产品信息" },
    ai_visibility: { en: "AI Visibility", zh: "AI 可见性" },
  };

  const isSchemaEmbedSuggestion = suggestion.id === "schema-embed-disabled";
  const isLlmsTxtSuggestion = suggestion.id === "llms-txt-optimization";
  const quickActionHref = isSchemaEmbedSuggestion
    ? buildAiVisibilityHref(location.search, { tab: "schema", fromTab: null, backTo: null, hash: "#product-schema-settings" })
    : buildAiVisibilityHref(location.search, { tab: "llms", fromTab: null, backTo: null });

  return (
    <div
      style={{
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        padding: 16,
        marginBottom: 12,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <span
              style={{
                background: colors.border,
                color: "white",
                padding: "2px 8px",
                borderRadius: 4,
                fontSize: 12,
                fontWeight: 500,
              }}
            >
              {suggestion.priority.toUpperCase()}
            </span>
            <span style={{ fontSize: 12, color: "#637381" }}>
              {isEnglish ? categoryLabels[suggestion.category]?.en : categoryLabels[suggestion.category]?.zh}
            </span>
          </div>
          <h4 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 600 }}>
            {isEnglish ? suggestion.title.en : suggestion.title.zh}
          </h4>
          <p style={{ margin: 0, fontSize: 14, color: "#555" }}>
            {isEnglish ? suggestion.description.en : suggestion.description.zh}
          </p>
        </div>
        {suggestion.estimatedLift && (
          <span
            style={{
              background: "#e6f7ff",
              color: "#0050b3",
              padding: "4px 8px",
              borderRadius: 4,
              fontSize: 12,
              fontWeight: 500,
              whiteSpace: "nowrap",
            }}
          >
            {suggestion.estimatedLift}
          </span>
        )}
      </div>

      {(isSchemaEmbedSuggestion || isLlmsTxtSuggestion) && (
        <div style={{ marginTop: 12 }}>
          <Link
            to={quickActionHref}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "10px 20px",
              background: "#008060",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            {isSchemaEmbedSuggestion ? `🚀 ${isEnglish ? "Enable Now" : "立即启用"}` : `⚙️ ${isEnglish ? "Configure Now" : "立即配置"}`}
          </Link>
        </div>
      )}

      {expanded && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid rgba(0,0,0,0.1)" }}>
          <div style={{ marginBottom: 12 }}>
            <strong style={{ fontSize: 14 }}>{isEnglish ? "Impact:" : "影响："}</strong>
            <p style={{ margin: "4px 0 0", fontSize: 14, color: "#555" }}>{suggestion.impact}</p>
          </div>
          <div style={{ marginBottom: 12 }}>
            <strong style={{ fontSize: 14 }}>{isEnglish ? "Action:" : "行动："}</strong>
            <p style={{ margin: "4px 0 0", fontSize: 14, color: "#555" }}>{suggestion.action}</p>
          </div>
          {suggestion.codeSnippet && <CodeSnippetBlock code={suggestion.codeSnippet} isEnglish={isEnglish} />}
          {suggestion.affectedProducts && suggestion.affectedProducts.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <strong style={{ fontSize: 14 }}>
                {isEnglish ? "Affected Products:" : "受影响产品："}
                <span style={{ fontWeight: "normal", color: "#637381" }}> ({suggestion.affectedProducts.length})</span>
              </strong>
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-label={expanded ? (isEnglish ? "Collapse details" : "收起详情") : (isEnglish ? "Expand details" : "展开详情")}
        style={{
          marginTop: 12,
          background: "transparent",
          border: "none",
          color: colors.text,
          cursor: "pointer",
          fontSize: 14,
          padding: 0,
        }}
      >
        {expanded ? (isEnglish ? "Show Less ▲" : "收起 ▲") : (isEnglish ? "Show Details ▼" : "查看详情 ▼")}
      </button>
    </div>
  );
};

export const OptimizationStatusBadge = ({
  status,
  isEnglish,
}: {
  status: "complete" | "partial" | "missing";
  isEnglish: boolean;
}) => {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.missing;
  return (
    <span
      style={{
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 12,
        background: config.bg,
        color: config.color,
      }}
    >
      {isEnglish ? config.label.en : config.label.zh}
    </span>
  );
};
