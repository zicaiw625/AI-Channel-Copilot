/**
 * AI 转化路径组件
 * 直观展示 AI 流量 → 结账 → 订单的转化路径
 */

import { getLocale, t, tp } from "../../lib/i18n";
import type { Lang } from "./types";

export interface PathStage {
  id: string;
  label: string;
  count: number;
  value?: number;
  aiCount: number;
  aiValue?: number;
}

export interface AIConversionPathProps {
  stages: PathStage[];
  lang: Lang;
  currency?: string;
  /** 是否为估算数据 */
  isEstimated?: boolean;
}

const stageIcons: Record<string, string> = {
  visit: "👀",
  add_to_cart: "🛒",
  cart: "🛒", // 兼容旧格式
  checkout_started: "💳",
  checkout: "💳", // 兼容旧格式
  order_created: "✅",
  order: "✅", // 兼容旧格式
};

/**
 * 格式化数字
 */
const formatNumber = (num: number): string => {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toLocaleString();
};

/**
 * 格式化货币（根据语言选择 locale）
 */
const formatCurrency = (value: number, currency: string = "USD", lang: Lang = "English"): string => {
  const locale = getLocale(lang);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
};

/**
 * 单个阶段节点
 */
const StageNode = ({
  stage,
  lang,
  currency,
  isEstimated,
}: {
  stage: PathStage;
  lang: Lang;
  currency: string;
  isEstimated?: boolean;
}) => {
  const icon = stageIcons[stage.id] || "📍";
  const aiRatio = stage.count > 0 ? (stage.aiCount / stage.count) * 100 : 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        minWidth: 120,
      }}
    >
      {/* 图标和标签 */}
      <div
        style={{
          fontSize: 24,
          marginBottom: 4,
        }}
      >
        {icon}
      </div>
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: "#212b36",
          marginBottom: 8,
        }}
      >
        {stage.label}
        {isEstimated && (
          <span
            style={{
              marginLeft: 4,
              fontSize: 9,
              color: "#919eab",
              verticalAlign: "super",
            }}
            title={t(lang, "estimated_value")}
          >
            ({t(lang, "estimate_short")}.)
          </span>
        )}
      </div>

      {/* 数据卡片 */}
      <div
        style={{
          background: "#fff",
          border: "1px solid #e1e3e5",
          borderRadius: 8,
          padding: 12,
          minWidth: 100,
          textAlign: "center",
        }}
      >
        {/* 总数 */}
        <div
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: "#212b36",
          }}
        >
          {formatNumber(stage.count)}
        </div>

        {/* AI 数量和占比 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
            marginTop: 4,
            padding: "2px 6px",
            background: "#f0f4ff",
            borderRadius: 4,
          }}
        >
          <span style={{ fontSize: 12, color: "#635bff", fontWeight: 600 }}>
            {formatNumber(stage.aiCount)}
          </span>
          <span style={{ fontSize: 10, color: "#919eab" }}>AI</span>
          <span style={{ fontSize: 10, color: "#635bff" }}>
            ({aiRatio.toFixed(1)}%)
          </span>
        </div>

        {/* 金额（如果有） */}
        {stage.value !== undefined && stage.value > 0 && (
          <div
            style={{
              marginTop: 8,
              paddingTop: 8,
              borderTop: "1px solid #f4f6f8",
            }}
          >
            <div style={{ fontSize: 11, color: "#637381" }}>
              {formatCurrency(stage.value, currency, lang)}
            </div>
            {stage.aiValue !== undefined && stage.aiValue > 0 && (
              <div style={{ fontSize: 11, color: "#635bff", fontWeight: 500 }}>
                AI: {formatCurrency(stage.aiValue, currency, lang)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * 箭头和转化率
 */
const ConversionArrow = ({
  fromCount,
  toCount,
  fromAi,
  toAi,
}: {
  fromCount: number;
  toCount: number;
  fromAi: number;
  toAi: number;
}) => {
  const overallRate = fromCount > 0 ? (toCount / fromCount) * 100 : 0;
  const aiRate = fromAi > 0 ? (toAi / fromAi) * 100 : 0;
  const diff = aiRate - overallRate;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "0 8px",
      }}
    >
      {/* 箭头 */}
      <div
        style={{
          fontSize: 20,
          color: "#c4cdd5",
          marginBottom: 4,
        }}
      >
        →
      </div>

      {/* 转化率 */}
      <div
        style={{
          background: "#f9fafb",
          borderRadius: 4,
          padding: "4px 8px",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 11, color: "#637381" }}>
          {overallRate.toFixed(1)}%
        </div>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: aiRate > overallRate ? "#2e7d32" : aiRate < overallRate ? "#de3618" : "#635bff",
          }}
        >
          AI: {aiRate.toFixed(1)}%
          {Math.abs(diff) > 0.1 && (
            <span style={{ fontSize: 9 }}>
              {" "}
              ({diff > 0 ? "+" : ""}{diff.toFixed(1)}%)
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * AI 转化路径组件
 */
export const AIConversionPath = ({
  stages,
  lang,
  currency = "USD",
  isEstimated = false,
}: AIConversionPathProps) => {
  if (stages.length === 0) {
    return (
      <div
        style={{
          padding: 24,
          textAlign: "center",
          color: "#637381",
        }}
      >
        {t(lang, "no_data_available")}
      </div>
    );
  }

  return (
    <div>
      {/* 标题说明 */}
      {isEstimated && (
        <div
          style={{
            background: "#fff8e5",
            border: "1px solid #f4a623",
            borderRadius: 4,
            padding: "8px 12px",
            marginBottom: 16,
            fontSize: 12,
            color: "#8a6116",
          }}
        >
          ⚠️{" "}
          {t(lang, "estimated_visit_cart_note")}
        </div>
      )}

      {/* 路径可视化 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexWrap: "wrap",
          gap: 8,
          padding: 16,
          background: "#fafbfc",
          borderRadius: 8,
        }}
      >
        {stages.map((stage, index) => (
          <div key={stage.id} style={{ display: "flex", alignItems: "center" }}>
            <StageNode
              stage={stage}
              lang={lang}
              currency={currency}
              // visit/add_to_cart/cart 阶段的数据是估算的（当 isEstimated=true 时）
              // checkout_started 和 order_created 使用真实数据（除非整体启用了估算模式）
              isEstimated={isEstimated && (stage.id === "visit" || stage.id === "add_to_cart" || stage.id === "cart")}
            />
            {index < stages.length - 1 && (
              <ConversionArrow
                fromCount={stage.count}
                toCount={stages[index + 1].count}
                fromAi={stage.aiCount}
                toAi={stages[index + 1].aiCount}
              />
            )}
          </div>
        ))}
      </div>

      {/* AI 渠道表现总结 */}
      {stages.length >= 2 && (
        <div
          style={{
            marginTop: 16,
            padding: 12,
            background: "#f0f4ff",
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span style={{ fontSize: 20 }}>💡</span>
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "#212b36",
                marginBottom: 2,
              }}
            >
              {t(lang, "ai_channel_insight")}
            </div>
            <div style={{ fontSize: 12, color: "#637381" }}>
              {(() => {
                const firstStage = stages[0];
                const lastStage = stages[stages.length - 1];
                const overallCvr =
                  firstStage.count > 0
                    ? (lastStage.count / firstStage.count) * 100
                    : 0;
                const aiCvr =
                  firstStage.aiCount > 0
                    ? (lastStage.aiCount / firstStage.aiCount) * 100
                    : 0;
                const diff = aiCvr - overallCvr;

                if (Math.abs(diff) < 0.5) {
                  return t(lang, "ai_conversion_similar");
                } else if (diff > 0) {
                  return tp(lang, "ai_conversion_better", { diff: diff.toFixed(1) });
                } else {
                  return tp(lang, "ai_conversion_lower", { diff: Math.abs(diff).toFixed(1) });
                }
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AIConversionPath;
