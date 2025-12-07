/**
 * 低样本量提示组件
 * 用更友好、更克制的方式提示商家数据处于积累阶段
 */

import type { Lang } from "./types";

export interface LowSampleNoticeProps {
  sampleCount: number;
  threshold: number;
  lang: Lang;
  /** 显示模式：inline 用于卡片内，banner 用于页面顶部 */
  variant?: "inline" | "banner";
  /** 是否显示扩展提示 */
  showTips?: boolean;
}

const tips = {
  en: [
    "AI channel attribution requires consistent traffic over time",
    "Results become more reliable as more orders are collected",
    "Consider extending the date range for a clearer picture",
  ],
  zh: [
    "AI 渠道归因需要持续一段时间的流量积累",
    "随着订单数据增加，结果会更加可靠",
    "可以尝试延长时间范围以获得更清晰的数据",
  ],
};

export const LowSampleNotice = ({
  sampleCount,
  threshold,
  lang,
  variant = "inline",
  showTips = false,
}: LowSampleNoticeProps) => {
  const en = lang === "English";
  const progress = Math.min((sampleCount / threshold) * 100, 100);

  // inline 模式：紧凑的徽章样式
  if (variant === "inline") {
    return (
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 8px",
          background: "#f4f6f8",
          borderRadius: 4,
          fontSize: 11,
          color: "#637381",
        }}
        title={en 
          ? `${sampleCount} AI orders detected, ${threshold} needed for reliable insights`
          : `检测到 ${sampleCount} 笔 AI 订单，需要 ${threshold} 笔以获得可靠分析`
        }
      >
        <span style={{ fontSize: 12 }}>📊</span>
        <span>
          {en ? "Building insights" : "数据积累中"}
        </span>
        <span
          style={{
            background: "#e0e0e0",
            borderRadius: 10,
            height: 4,
            width: 40,
            overflow: "hidden",
          }}
        >
          <span
            style={{
              display: "block",
              height: "100%",
              width: `${progress}%`,
              background: "#635bff",
              borderRadius: 10,
              transition: "width 0.3s ease",
            }}
          />
        </span>
        <span style={{ fontFamily: "monospace", fontSize: 10 }}>
          {sampleCount}/{threshold}
        </span>
      </div>
    );
  }

  // banner 模式：更详细的提示
  return (
    <div
      style={{
        background: "linear-gradient(135deg, #f8f9fb 0%, #f0f4f8 100%)",
        border: "1px solid #e1e3e5",
        borderRadius: 8,
        padding: 16,
        marginBottom: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        {/* 进度环 */}
        <div
          style={{
            position: "relative",
            width: 48,
            height: 48,
            flexShrink: 0,
          }}
        >
          <svg width="48" height="48" viewBox="0 0 48 48">
            <circle
              cx="24"
              cy="24"
              r="20"
              fill="none"
              stroke="#e0e0e0"
              strokeWidth="4"
            />
            <circle
              cx="24"
              cy="24"
              r="20"
              fill="none"
              stroke="#635bff"
              strokeWidth="4"
              strokeDasharray={`${progress * 1.26} 126`}
              strokeLinecap="round"
              transform="rotate(-90 24 24)"
              style={{ transition: "stroke-dasharray 0.5s ease" }}
            />
          </svg>
          <span
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              fontSize: 10,
              fontWeight: 600,
              color: "#635bff",
            }}
          >
            {Math.round(progress)}%
          </span>
        </div>

        {/* 文案 */}
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "#212b36",
              marginBottom: 4,
            }}
          >
            {en ? "Building Your AI Insights" : "正在积累 AI 渠道数据"}
          </div>
          <div style={{ fontSize: 13, color: "#637381", lineHeight: 1.5 }}>
            {en
              ? `We've detected ${sampleCount} AI-attributed orders so far. For reliable trends, we recommend waiting until you have at least ${threshold} orders.`
              : `目前已检测到 ${sampleCount} 笔 AI 归因订单。建议等待至少 ${threshold} 笔订单后再分析趋势，数据会更可靠。`}
          </div>

          {showTips && (
            <div style={{ marginTop: 12 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#919eab",
                  textTransform: "uppercase",
                  marginBottom: 6,
                }}
              >
                {en ? "What you can do" : "建议操作"}
              </div>
              <ul
                style={{
                  margin: 0,
                  paddingLeft: 16,
                  fontSize: 12,
                  color: "#637381",
                  lineHeight: 1.6,
                }}
              >
                {(en ? tips.en : tips.zh).map((tip, i) => (
                  <li key={i}>{tip}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * 估算值标记组件
 * 用于标记那些基于有限数据的估算值
 */
export const EstimateTag = ({
  lang,
  tooltip,
}: {
  lang: Lang;
  tooltip?: string;
}) => {
  const en = lang === "English";
  const defaultTooltip = en
    ? "This value is an estimate based on limited data"
    : "此数值为基于有限数据的估算";

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        marginLeft: 4,
        padding: "1px 4px",
        fontSize: 9,
        fontWeight: 500,
        color: "#919eab",
        background: "#f4f6f8",
        borderRadius: 2,
        cursor: "help",
        verticalAlign: "middle",
      }}
      title={tooltip || defaultTooltip}
    >
      {en ? "est." : "估"}
    </span>
  );
};

export default LowSampleNotice;
