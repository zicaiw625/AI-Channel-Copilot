/**
 * WhyAI 证据链组件
 * 将 AI 归因信号可视化展示，帮助商家理解"为什么这个订单被标记为 AI"
 */

import { useState } from "react";
import type { Lang } from "./types";

export type ConfidenceLevel = "high" | "medium" | "low";

export interface WhyAIProps {
  aiSource: string | null;
  referrer: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  sourceName: string | null;
  detection: string | null;
  signals: string[] | null;
  lang: Lang;
  /** 紧凑模式：只显示置信度徽章，点击展开详情 */
  compact?: boolean;
}

/**
 * 从 detection 字符串中解析置信度
 */
const parseConfidence = (detection: string | null): ConfidenceLevel => {
  if (!detection) return "low";
  const lower = detection.toLowerCase();
  if (lower.includes("confidence: high") || lower.includes("置信度高") || lower.includes("高置信度")) {
    return "high";
  }
  if (lower.includes("confidence: medium") || lower.includes("置信度中等")) {
    return "medium";
  }
  return "low";
};

/**
 * 置信度颜色映射
 */
const confidenceColors: Record<ConfidenceLevel, { bg: string; text: string; border: string }> = {
  high: { bg: "#e6f7ed", text: "#2e7d32", border: "#50b83c" },
  medium: { bg: "#fff8e5", text: "#8a6116", border: "#f4a623" },
  low: { bg: "#f4f6f8", text: "#637381", border: "#c4cdd5" },
};

/**
 * 置信度标签
 */
const confidenceLabels: Record<ConfidenceLevel, { en: string; zh: string }> = {
  high: { en: "High Confidence", zh: "高置信度" },
  medium: { en: "Medium Confidence", zh: "中等置信度" },
  low: { en: "Low Confidence", zh: "低置信度" },
};

/**
 * 解析检测结果，提取匹配类型
 */
const parseMatchType = (
  detection: string | null,
  referrer: string | null,
  utmSource: string | null,
  lang: Lang
): { type: string; value: string; icon: string }[] => {
  const matches: { type: string; value: string; icon: string }[] = [];
  const en = lang === "English";

  // 检查 referrer 匹配
  if (detection?.includes("referrer matched") || detection?.includes("来源域名匹配")) {
    const domainMatch = detection.match(/matched\s+([^\s·]+)/i) || 
                        detection.match(/匹配\s+([^\s·]+)/);
    matches.push({
      type: en ? "Referrer Domain" : "来源域名",
      value: domainMatch?.[1] || referrer || "-",
      icon: "🔗",
    });
  } else if (referrer && referrer !== "-") {
    matches.push({
      type: en ? "Referrer" : "来源",
      value: referrer,
      icon: "🔗",
    });
  }

  // 检查 utm_source 匹配
  if (detection?.includes("utm_source") || utmSource) {
    matches.push({
      type: "utm_source",
      value: utmSource || "-",
      icon: "🏷️",
    });
  }

  // 检查标签匹配
  if (detection?.includes("existing tag") || detection?.includes("标签")) {
    matches.push({
      type: en ? "Existing Tag" : "已有标签",
      value: en ? "Pre-tagged by app" : "应用已标记",
      icon: "🔖",
    });
  }

  // 检查备注属性匹配
  if (detection?.includes("Note attribute") || detection?.includes("备注属性")) {
    matches.push({
      type: en ? "Note Attribute" : "备注属性",
      value: en ? "Detected from order notes" : "从订单备注检测",
      icon: "📝",
    });
  }

  return matches;
};

/**
 * 置信度徽章组件
 */
export const ConfidenceBadge = ({
  level,
  lang,
  size = "normal",
}: {
  level: ConfidenceLevel;
  lang: Lang;
  size?: "small" | "normal";
}) => {
  const colors = confidenceColors[level];
  const label = lang === "English" ? confidenceLabels[level].en : confidenceLabels[level].zh;
  const isSmall = size === "small";

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: isSmall ? "2px 6px" : "4px 8px",
        fontSize: isSmall ? 10 : 12,
        fontWeight: 500,
        color: colors.text,
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        borderRadius: 4,
      }}
      title={label}
    >
      {level === "high" && "✓"}
      {level === "medium" && "~"}
      {level === "low" && "?"}
      {!isSmall && <span>{label}</span>}
    </span>
  );
};

/**
 * WhyAI 展开面板组件
 */
export const WhyAI = ({
  aiSource,
  referrer,
  utmSource,
  utmMedium,
  sourceName,
  detection,
  signals,
  lang,
  compact = false,
}: WhyAIProps) => {
  const [expanded, setExpanded] = useState(false);
  const en = lang === "English";
  const confidence = parseConfidence(detection);
  const matches = parseMatchType(detection, referrer, utmSource, lang);
  const colors = confidenceColors[confidence];

  // 没有 AI 来源时不显示
  if (!aiSource) {
    return (
      <span style={{ color: "#919eab", fontSize: 12 }}>
        {en ? "Not AI" : "非 AI"}
      </span>
    );
  }

  // 紧凑模式：只显示可点击的徽章
  if (compact) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
        }}
        title={en ? "Click to see why" : "点击查看原因"}
      >
        <span style={{ fontWeight: 500 }}>{aiSource}</span>
        <ConfidenceBadge level={confidence} lang={lang} size="small" />
        <span style={{ fontSize: 10, color: "#637381" }}>
          {expanded ? "▲" : "▼"}
        </span>
      </button>
    );
  }

  return (
    <div>
      {/* 头部：AI 来源 + 置信度 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span
          style={{
            fontWeight: 600,
            color: "#635bff",
            fontSize: 14,
          }}
        >
          {aiSource}
        </span>
        <ConfidenceBadge level={confidence} lang={lang} />
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          style={{
            background: "none",
            border: "none",
            color: "#637381",
            cursor: "pointer",
            fontSize: 12,
            padding: "2px 4px",
          }}
        >
          {expanded ? (en ? "Hide Details" : "收起") : (en ? "Why AI?" : "为什么?")}
        </button>
      </div>

      {/* 展开的详情面板 */}
      {expanded && (
        <div
          style={{
            background: colors.bg,
            border: `1px solid ${colors.border}`,
            borderRadius: 8,
            padding: 12,
            marginTop: 8,
          }}
        >
          {/* 匹配证据 */}
          <div style={{ marginBottom: 12 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "#637381",
                textTransform: "uppercase",
                marginBottom: 8,
              }}
            >
              {en ? "Detection Evidence" : "识别证据"}
            </div>
            {matches.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {matches.map((match, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 13,
                    }}
                  >
                    <span style={{ fontSize: 14 }}>{match.icon}</span>
                    <span style={{ color: "#637381", minWidth: 80 }}>{match.type}:</span>
                    <span
                      style={{
                        fontFamily: "monospace",
                        background: "#fff",
                        padding: "2px 6px",
                        borderRadius: 3,
                        fontSize: 12,
                        wordBreak: "break-all",
                      }}
                    >
                      {match.value}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "#919eab" }}>
                {en ? "No specific evidence recorded" : "未记录具体证据"}
              </div>
            )}
          </div>

          {/* 额外信号 */}
          {signals && signals.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#637381",
                  textTransform: "uppercase",
                  marginBottom: 6,
                }}
              >
                {en ? "Additional Signals" : "其他信号"}
              </div>
              <ul
                style={{
                  margin: 0,
                  paddingLeft: 16,
                  fontSize: 12,
                  color: "#555",
                }}
              >
                {signals.map((signal, i) => (
                  <li key={i}>{signal}</li>
                ))}
              </ul>
            </div>
          )}

          {/* utm_medium */}
          {utmMedium && (
            <div
              style={{
                fontSize: 12,
                color: "#637381",
                borderTop: "1px solid rgba(0,0,0,0.1)",
                paddingTop: 8,
              }}
            >
              utm_medium: <code style={{ background: "#fff", padding: "1px 4px" }}>{utmMedium}</code>
            </div>
          )}

          {/* source_name */}
          {sourceName && (
            <div style={{ fontSize: 12, color: "#637381", marginTop: 4 }}>
              source_name: <code style={{ background: "#fff", padding: "1px 4px" }}>{sourceName}</code>
            </div>
          )}

          {/* 原始 detection 字符串（调试用） */}
          {detection && (
            <details style={{ marginTop: 8 }}>
              <summary
                style={{
                  fontSize: 11,
                  color: "#919eab",
                  cursor: "pointer",
                }}
              >
                {en ? "Raw Detection" : "原始检测结果"}
              </summary>
              <div
                style={{
                  fontSize: 11,
                  fontFamily: "monospace",
                  background: "#f4f6f8",
                  padding: 8,
                  borderRadius: 4,
                  marginTop: 4,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                }}
              >
                {detection}
              </div>
            </details>
          )}

          {/* 置信度说明 */}
          <div
            style={{
              marginTop: 12,
              padding: "8px 10px",
              background: "rgba(255,255,255,0.8)",
              borderRadius: 4,
              fontSize: 11,
              color: "#637381",
            }}
          >
            {confidence === "high" && (
              <>
                ✅{" "}
                {en
                  ? "Referrer domain matched a known AI source. This is reliable evidence."
                  : "来源域名匹配已知的 AI 平台，这是可靠的证据。"}
              </>
            )}
            {confidence === "medium" && (
              <>
                ⚠️{" "}
                {en
                  ? "Detected via UTM or existing tag. May need verification."
                  : "通过 UTM 参数或已有标签识别，可能需要核实。"}
              </>
            )}
            {confidence === "low" && (
              <>
                ❓{" "}
                {en
                  ? "Weak signal or only medium keyword match. Consider reviewing rules."
                  : "信号较弱或仅匹配 medium 关键词，建议检查规则配置。"}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default WhyAI;
