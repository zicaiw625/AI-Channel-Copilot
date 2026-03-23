import { Banner, Card } from "../ui";
import type { FunnelMetrics } from "../../lib/funnelService.server";

const isEstimatedStage = (stage: string): boolean => {
  return stage === "visit" || stage === "add_to_cart";
};

export function FunnelChart({
  stages,
  language,
  maxCount,
  isEstimated = true,
  currency,
}: {
  stages: FunnelMetrics[];
  language: string;
  maxCount: number;
  isEstimated?: boolean;
  currency: string;
}) {
  const isEnglish = language === "English";
  const locale = isEnglish ? "en-US" : "zh-CN";
  const formatMoney = (value: number) =>
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  const hasData = stages.some((stage) => stage.count > 0);

  if (!hasData) {
    return (
      <Banner status="info" title={isEnglish ? "No funnel data available" : "暂无漏斗数据"}>
        {isEnglish ? "Data will appear once orders are received." : "收到订单后数据将自动更新。"}
      </Banner>
    );
  }

  return (
    <div
      style={{ padding: "20px 0" }}
      role="img"
      aria-label={isEnglish
        ? `Funnel chart showing ${stages.length} stages from ${stages[0]?.label} to ${stages[stages.length - 1]?.label}`
        : `漏斗图表，显示从 ${stages[0]?.label} 到 ${stages[stages.length - 1]?.label} 的 ${stages.length} 个阶段`}
    >
      <div className="sr-only" role="list" aria-label={isEnglish ? "Funnel stages" : "漏斗阶段"}>
        {stages.map((stage) => (
          <div key={`sr-${stage.stage}`} role="listitem">
            {stage.label}: {stage.count.toLocaleString()}
            ({(stage.conversionRate * 100).toFixed(1)}% {isEnglish ? "conversion" : "转化率"})
            {stage.value > 0 && ` - ${formatMoney(stage.value)}`}
          </div>
        ))}
      </div>

      {stages.map((stage, index) => {
        const widthPercent = maxCount > 0 ? (stage.count / maxCount) * 100 : 0;
        const nextStage = stages[index + 1];
        const dropoff = nextStage && stage.count > 0
          ? ((stage.count - nextStage.count) / stage.count * 100).toFixed(1)
          : null;
        const stageIsEstimated = isEstimated && isEstimatedStage(stage.stage);

        return (
          <div key={stage.stage} style={{ marginBottom: 24 }} aria-hidden="true">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{stage.label}</span>
                {stageIsEstimated && (
                  <span
                    style={{
                      fontSize: 10,
                      padding: "2px 6px",
                      background: "#fff7e6",
                      color: "#d46b08",
                      borderRadius: 4,
                      border: "1px solid #ffd591",
                    }}
                    title={isEnglish ? "This value is estimated based on order patterns" : "此数值基于订单模式估算"}
                  >
                    {isEnglish ? "Est." : "估算"}
                  </span>
                )}
              </div>
              <span style={{ color: "#637381", fontSize: 14 }}>
                {stageIsEstimated && "~"}{stage.count.toLocaleString()}
                {stage.value > 0 && ` · ${formatMoney(stage.value)}`}
              </span>
            </div>
            <div
              style={{
                position: "relative",
                height: 40,
                background: "#f4f6f8",
                borderRadius: 8,
                overflow: "hidden",
              }}
              role="progressbar"
              aria-valuenow={Math.round(stage.conversionRate * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${stage.label}: ${(stage.conversionRate * 100).toFixed(1)}%`}
            >
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  height: "100%",
                  width: `${widthPercent}%`,
                  minWidth: widthPercent > 0 ? 8 : 0,
                  background: "#635bff",
                  borderRadius: 8,
                  transition: "width 0.5s ease",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  right: 12,
                  top: "50%",
                  transform: "translateY(-50%)",
                  fontSize: 12,
                  color: "#212b36",
                  fontWeight: 500,
                }}
              >
                {(stage.conversionRate * 100).toFixed(1)}%
              </div>
            </div>
            {dropoff && parseFloat(dropoff) > 0 && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginTop: 8,
                  paddingLeft: 20,
                }}
                aria-label={isEnglish ? `${dropoff}% drop-off to next stage` : `到下一阶段流失 ${dropoff}%`}
              >
                <span style={{ color: "#de3618", fontSize: 12 }} aria-hidden="true">↓</span>
                <span style={{ color: "#de3618", fontSize: 12 }}>
                  {isEnglish ? `${dropoff}% drop-off` : `${dropoff}% 流失`}
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ConversionCard({
  title,
  rate,
  aiRate,
  language,
  isEstimated = false,
}: {
  title: string;
  rate: number;
  aiRate: number;
  language: string;
  isEstimated?: boolean;
}) {
  const isEnglish = language === "English";
  const diff = aiRate - rate;
  const diffColor = diff >= 0 ? "#50b83c" : "#de3618";

  return (
    <Card
      padding="tight"
      style={{
        border: isEstimated ? "1px dashed #ffd591" : "1px solid #e0e0e0",
        flex: 1,
        position: "relative",
      }}
      aria-label={`${title}: ${isEnglish ? "Overall" : "全站"} ${(rate * 100).toFixed(1)}%, AI ${(aiRate * 100).toFixed(1)}%`}
    >
      {isEstimated && (
        <span
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            fontSize: 9,
            padding: "2px 5px",
            background: "#fff7e6",
            color: "#d46b08",
            borderRadius: 3,
            border: "1px solid #ffd591",
          }}
          title={isEnglish ? "Based on estimated data" : "基于估算数据"}
        >
          {isEnglish ? "Est." : "估算"}
        </span>
      )}
      <p style={{ margin: "0 0 8px", fontSize: 12, color: "#637381" }} id={`card-title-${title.replace(/\s+/g, "-")}`}>
        {title}
      </p>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 24, fontWeight: 700 }} aria-label={`${(rate * 100).toFixed(1)}% ${isEnglish ? "overall" : "全站"}`}>
          {isEstimated && "~"}{(rate * 100).toFixed(1)}%
        </span>
        <span style={{ fontSize: 12, color: "#637381" }}>{isEnglish ? "Overall" : "全站"}</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
        <span style={{ fontSize: 18, fontWeight: 600, color: "#635bff" }}>
          {isEstimated && "~"}{(aiRate * 100).toFixed(1)}%
        </span>
        <span style={{ fontSize: 12, color: "#637381" }}>{isEnglish ? "AI Channels" : "AI 渠道"}</span>
        {Math.abs(diff) > 0.001 && (
          <span style={{ fontSize: 12, color: diffColor }}>
            ({diff >= 0 ? "+" : ""}{(diff * 100).toFixed(1)}%)
          </span>
        )}
      </div>
    </Card>
  );
}
