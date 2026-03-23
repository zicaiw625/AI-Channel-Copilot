import { useMemo, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData, useNavigate, useLocation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { getSettings } from "../lib/settings.server";
import { getFunnelData, type FunnelMetrics } from "../lib/funnelService.server";
import { useUILanguage } from "../lib/useUILanguage";
import styles from "../styles/app.dashboard.module.css";
import { AI_CHANNELS, timeRanges, type TimeRangeKey } from "../lib/aiData";
import { AIConversionPath, type PathStage } from "../components/dashboard";
import { buildEmbeddedAppPath, getPreservedSearchParams } from "../lib/navigation";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const shopDomain = session.shop;
  const settings = await getSettings(shopDomain);
  const language = settings.languages?.[0] || "中文";
  const timezone = settings.timezones?.[0] || "UTC";
  
  const url = new URL(request.url);
  const rangeKey = (url.searchParams.get("range") as TimeRangeKey) || "30d";

  const funnelData = await getFunnelData(shopDomain, {
    range: rangeKey,
    timezone,
    language,
  });

  return {
    funnelData,
    language,
    timezone,
    rangeKey,
    shopDomain,
    currency: settings.primaryCurrency || "USD",
    isEstimated: funnelData.isEstimated,
  };
};

// 判断漏斗阶段是否为估算数据
const isEstimatedStage = (stage: string): boolean => {
  return stage === "visit" || stage === "add_to_cart";
};

// 漏斗可视化组件
const FunnelChart = ({ 
  stages, 
  language,
  maxCount,
  isEstimated = true,
}: { 
  stages: FunnelMetrics[]; 
  language: string;
  maxCount: number;
  isEstimated?: boolean;
}) => {
  const isEnglish = language === "English";
  
  // 检查是否有数据
  const hasData = stages.some(s => s.count > 0);
  
  if (!hasData) {
    return (
      <div 
        style={{ 
          padding: "40px 20px", 
          textAlign: "center",
          color: "#637381",
        }}
        role="status"
        aria-label={isEnglish ? "No funnel data available" : "暂无漏斗数据"}
      >
        <p style={{ margin: 0, fontSize: 14 }}>
          {isEnglish ? "No data available for this period" : "该时间段内暂无数据"}
        </p>
        <p style={{ margin: "8px 0 0", fontSize: 12, color: "#919eab" }}>
          {isEnglish 
            ? "Data will appear once orders are received" 
            : "收到订单后数据将自动更新"}
        </p>
      </div>
    );
  }
  
  return (
    <div 
      style={{ padding: "20px 0" }}
      role="img"
      aria-label={isEnglish 
        ? `Funnel chart showing ${stages.length} stages from ${stages[0]?.label} to ${stages[stages.length - 1]?.label}`
        : `漏斗图表，显示从 ${stages[0]?.label} 到 ${stages[stages.length - 1]?.label} 的 ${stages.length} 个阶段`
      }
    >
      {/* 屏幕阅读器专用摘要 */}
      <div className="sr-only" role="list" aria-label={isEnglish ? "Funnel stages" : "漏斗阶段"}>
        {stages.map((stage) => (
          <div key={`sr-${stage.stage}`} role="listitem">
            {stage.label}: {stage.count.toLocaleString()} 
            ({(stage.conversionRate * 100).toFixed(1)}% {isEnglish ? "conversion" : "转化率"})
            {stage.value > 0 && ` - $${stage.value.toLocaleString()}`}
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
                {stage.value > 0 && ` · $${stage.value.toLocaleString()}`}
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
                aria-label={isEnglish 
                  ? `${dropoff}% drop-off to next stage` 
                  : `到下一阶段流失 ${dropoff}%`
                }
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
};

// 转化率卡片
const ConversionCard = ({
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
}) => {
  const isEnglish = language === "English";
  const diff = aiRate - rate;
  const diffColor = diff >= 0 ? "#50b83c" : "#de3618";
  
  return (
    <article
      style={{
        background: "#fff",
        border: isEstimated ? "1px dashed #ffd591" : "1px solid #e0e0e0",
        borderRadius: 8,
        padding: 16,
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
      <p style={{ margin: "0 0 8px", fontSize: 12, color: "#637381" }} id={`card-title-${title.replace(/\s+/g, '-')}`}>
        {title}
      </p>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 24, fontWeight: 700 }} aria-label={`${(rate * 100).toFixed(1)}% ${isEnglish ? "overall" : "全站"}`}>
          {isEstimated && "~"}{(rate * 100).toFixed(1)}%
        </span>
        <span style={{ fontSize: 12, color: "#637381" }}>
          {isEnglish ? "Overall" : "全站"}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
        <span style={{ fontSize: 18, fontWeight: 600, color: "#635bff" }}>
          {isEstimated && "~"}{(aiRate * 100).toFixed(1)}%
        </span>
        <span style={{ fontSize: 12, color: "#637381" }}>
          {isEnglish ? "AI Channels" : "AI 渠道"}
        </span>
        {Math.abs(diff) > 0.001 && (
          <span style={{ fontSize: 12, color: diffColor }}>
            ({diff >= 0 ? "+" : ""}{(diff * 100).toFixed(1)}%)
          </span>
        )}
      </div>
    </article>
  );
};

export default function FunnelAnalysis() {
  const { funnelData, language, rangeKey, shopDomain: _shopDomain, currency } = useLoaderData<typeof loader>();
  const uiLanguage = useUILanguage(language);
  const isEnglish = uiLanguage === "English";
  const navigate = useNavigate();
  const location = useLocation();
  
  const [selectedChannel, setSelectedChannel] = useState<string>("all");
  
  const maxCount = useMemo(() => {
    const counts = [
      ...funnelData.overall.map(s => s.count),
      ...funnelData.aiChannels.map(s => s.count),
    ];
    return counts.length > 0 ? Math.max(...counts) : 0;
  }, [funnelData]);
  
  const selectedFunnel = useMemo(() => {
    if (selectedChannel === "all") return funnelData.overall;
    if (selectedChannel === "ai") return funnelData.aiChannels;
    return funnelData.byChannel[selectedChannel] || funnelData.overall;
  }, [selectedChannel, funnelData]);
  const backTo = new URLSearchParams(location.search).get("backTo");
  const optimizationHref = buildEmbeddedAppPath("/app/optimization", location.search, { backTo: null });
  const dashboardHref = buildEmbeddedAppPath("/app", location.search, { backTo: null });
  const backHref = backTo === "dashboard" ? dashboardHref : optimizationHref;
  const backLabel = backTo === "dashboard"
    ? (isEnglish ? "Back to Dashboard" : "返回仪表盘")
    : (isEnglish ? "Back to Optimization" : "返回优化建议");
  
  const setRange = (value: TimeRangeKey) => {
    const params = getPreservedSearchParams(location.search);
    params.set("range", value);
    navigate({ search: `?${params.toString()}` });
  };

  return (
    <s-page heading={isEnglish ? "Funnel Analysis" : "漏斗分析"}>
      <div className={styles.page}>
        <div style={{ marginBottom: 16, display: "flex", gap: 12, justifyContent: "space-between", alignItems: "center" }}>
          <Link to={backHref} className={styles.secondaryButton}>
            ← {backLabel}
          </Link>

          <div className={styles.rangePills}>
            {(Object.keys(timeRanges) as TimeRangeKey[]).filter(k => k !== "custom").map((key) => (
              <button
                key={key}
                className={`${styles.pill} ${rangeKey === key ? styles.pillActive : ""}`}
                onClick={() => setRange(key)}
                type="button"
              >
                {isEnglish 
                  ? key === "7d" ? "7 Days" : key === "30d" ? "30 Days" : "90 Days"
                  : timeRanges[key].label}
              </button>
            ))}
          </div>
        </div>

        {/* 🆕 增强版数据来源说明 - 清晰的估算 vs 实际数据分层 */}
        <div className={styles.card}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.sectionLabel}>{isEnglish ? "Funnel Attribution" : "漏斗归因"}</p>
              <h3 className={styles.sectionTitle}>
                {isEnglish ? "Visit → Add to Cart → Checkout → Order" : "访问 → 加购 → 结账 → 成交"}
              </h3>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <span className={styles.badge}>
                {isEnglish ? "Beta" : "测试版"}
              </span>
            </div>
          </div>
          
          {/* 🆕 数据来源分层说明 - 更清晰的估算 vs 实际 */}
          <div style={{ 
            display: "grid", 
            gridTemplateColumns: "1fr 1fr", 
            gap: 12, 
            marginBottom: 16,
          }}>
            {/* 实际数据区域 */}
            <div style={{ 
              padding: "12px 16px", 
              background: "#f6ffed",
              border: "1px solid #b7eb8f",
              borderRadius: 8,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ 
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 24, 
                  height: 24, 
                  borderRadius: "50%", 
                  background: "#52c41a",
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: "bold",
                }}>✓</span>
                <strong style={{ fontSize: 14, color: "#237804" }}>
                  {isEnglish ? "Actual Store Data" : "店铺实际数据"}
                </strong>
              </div>
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13, color: "#555", lineHeight: 1.6 }}>
                <li><strong>{isEnglish ? "Checkout" : "结账"}</strong>: {isEnglish ? "From Shopify Checkout Webhooks" : "来自 Shopify Checkout Webhooks"}</li>
                <li><strong>{isEnglish ? "Order" : "订单"}</strong>: {isEnglish ? "From Shopify Order Webhooks" : "来自 Shopify Order Webhooks"}</li>
                <li style={{ color: "#237804", fontStyle: "italic" }}>
                  {isEnglish ? "These metrics are sourced directly from Shopify events and are suitable for operational reporting" : "这些指标直接来自 Shopify 事件，适合用于运营复盘"}
                </li>
              </ul>
            </div>
            
            {/* 估算数据区域 */}
            <div style={{ 
              padding: "12px 16px", 
              background: "#fffbe6",
              border: "1px dashed #faad14",
              borderRadius: 8,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ 
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 24, 
                  height: 24, 
                  borderRadius: "50%", 
                  background: "#faad14",
                  color: "#fff",
                  fontSize: 14,
                }}>~</span>
                <strong style={{ fontSize: 14, color: "#ad6800" }}>
                  {isEnglish ? "Estimated Data (Reference Only)" : "估算数据（仅供参考）"}
                </strong>
              </div>
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13, color: "#555", lineHeight: 1.6 }}>
                <li><strong>{isEnglish ? "Visit" : "访问"}</strong>: {isEnglish ? "Estimated from order patterns" : "基于订单模式估算"}</li>
                <li><strong>{isEnglish ? "Add to Cart" : "加购"}</strong>: {isEnglish ? "Estimated from checkout data" : "基于结账数据估算"}</li>
                <li style={{ color: "#ad6800", fontStyle: "italic" }}>
                  {isEnglish 
                    ? "Based on e-commerce industry averages (adjustable)" 
                    : "基于电商行业平均值（可调整）"}
                </li>
              </ul>
            </div>
          </div>

          {/* 🆕 估算方法说明 */}
          <details style={{ 
            background: "#f9f9f9", 
            borderRadius: 6, 
            padding: "8px 12px",
            marginBottom: 12,
            fontSize: 12,
            color: "#666",
          }}>
            <summary style={{ cursor: "pointer", fontWeight: 500, color: "#333" }}>
              {isEnglish ? "📊 How estimates are calculated" : "📊 估算方法说明"}
            </summary>
            <div style={{ marginTop: 8, paddingLeft: 4 }}>
              <p style={{ margin: "4px 0" }}>
                {isEnglish 
                  ? "Our estimates use industry-standard conversion rates:" 
                  : "我们使用行业标准转化率进行估算："}
              </p>
              <ul style={{ margin: "4px 0 0", paddingLeft: 16 }}>
                <li>{isEnglish ? "Checkout → Order rate: ~70%" : "结账 → 订单转化率：约 70%"}</li>
                <li>{isEnglish ? "Visits per checkout: ~10" : "每次结账对应访问数：约 10"}</li>
                <li>{isEnglish ? "Carts per checkout: ~2" : "每次结账对应加购数：约 2"}</li>
              </ul>
              <p style={{ margin: "8px 0 0", fontStyle: "italic" }}>
                {isEnglish 
                  ? "💡 Tip: For accurate Visit/Cart data, enable client-side tracking or checkout webhooks." 
                  : "💡 提示：如需准确的访问/加购数据，可启用客户端追踪或 checkout webhooks。"}
              </p>
            </div>
          </details>

          <p className={styles.helpText}>
            {isEnglish
              ? "Track how AI-referred visitors convert through your purchase funnel. Checkout and Order data come from Shopify events; Visit/Cart remain estimates."
              : "追踪 AI 引荐访客在购买漏斗中的转化情况。结账和订单数据来自 Shopify 事件；访问/加购仍为估算值。"}
          </p>
        </div>

        {/* 转化率概览 */}
        <div style={{ display: "flex", gap: 16, marginBottom: 24 }}>
          <ConversionCard
            title={isEnglish ? "Visit → Cart" : "访问 → 加购"}
            rate={funnelData.conversionRates.visitToCart}
            aiRate={funnelData.conversionRates.aiVisitToCart}
            language={uiLanguage}
            isEstimated={funnelData.isEstimated.visits || funnelData.isEstimated.carts}
          />
          <ConversionCard
            title={isEnglish ? "Cart → Checkout" : "加购 → 结账"}
            rate={funnelData.conversionRates.cartToCheckout}
            aiRate={funnelData.conversionRates.aiCartToCheckout}
            language={uiLanguage}
            isEstimated={funnelData.isEstimated.carts || funnelData.isEstimated.checkouts}
          />
          <ConversionCard
            title={isEnglish ? "Checkout → Order" : "结账 → 订单"}
            rate={funnelData.conversionRates.checkoutToOrder}
            aiRate={funnelData.conversionRates.aiCheckoutToOrder}
            language={uiLanguage}
            isEstimated={funnelData.isEstimated.checkouts}
          />
          <ConversionCard
            title={isEnglish ? "Visit → Order" : "访问 → 订单"}
            rate={funnelData.conversionRates.visitToOrder}
            aiRate={funnelData.conversionRates.aiVisitToOrder}
            language={uiLanguage}
            isEstimated={funnelData.isEstimated.visits}
          />
        </div>

        {/* AI 转化路径可视化 */}
        <div className={styles.card} style={{ marginBottom: 24 }}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.sectionLabel}>{isEnglish ? "Conversion Path" : "转化路径"}</p>
              <h3 className={styles.sectionTitle}>
                {isEnglish ? "AI Channel Journey" : "AI 渠道转化旅程"}
              </h3>
            </div>
            <span className={styles.badge} style={{ background: "#f0f4ff", color: "#635bff" }}>
              {isEnglish ? "AI vs Overall" : "AI vs 全站"}
            </span>
          </div>
          <AIConversionPath
            stages={funnelData.overall.map((stage): PathStage => ({
              id: stage.stage,
              label: stage.label,
              count: stage.count,
              value: stage.value,
              aiCount: funnelData.aiChannels.find(s => s.stage === stage.stage)?.count || 0,
              aiValue: funnelData.aiChannels.find(s => s.stage === stage.stage)?.value || 0,
            }))}
            lang={uiLanguage === "English" ? "English" : "中文"}
            currency={currency}
            isEstimated={funnelData.isEstimated.visits || funnelData.isEstimated.carts}
          />
        </div>

        <div className={styles.twoCol}>
          {/* 漏斗可视化 */}
          <div className={styles.card}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.sectionLabel}>{isEnglish ? "Funnel Visualization" : "漏斗可视化"}</p>
                <h3 className={styles.sectionTitle}>
                  {selectedChannel === "all" 
                    ? (isEnglish ? "All Traffic" : "全部流量")
                    : selectedChannel === "ai"
                      ? (isEnglish ? "AI Channels" : "AI 渠道")
                      : selectedChannel}
                </h3>
              </div>
              <select
                value={selectedChannel}
                onChange={(e) => setSelectedChannel(e.target.value)}
                className={styles.select}
                aria-label={isEnglish ? "Select traffic channel" : "选择流量渠道"}
              >
                <option value="all">{isEnglish ? "All Traffic" : "全部流量"}</option>
                <option value="ai">{isEnglish ? "AI Channels (Total)" : "AI 渠道（汇总）"}</option>
                {AI_CHANNELS.map(channel => (
                  <option key={channel} value={channel}>{channel}</option>
                ))}
              </select>
            </div>
            
            <FunnelChart
              stages={selectedFunnel}
              language={uiLanguage}
              maxCount={maxCount}
              isEstimated={funnelData.isEstimated.visits || funnelData.isEstimated.carts}
            />
          </div>

          {/* 放弃率分析 */}
          <div className={styles.card}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.sectionLabel}>{isEnglish ? "Abandonment Analysis" : "放弃率分析"}</p>
                <h3 className={styles.sectionTitle}>
                  {isEnglish ? "Where Customers Drop Off" : "客户流失节点"}
                </h3>
              </div>
              {(funnelData.isEstimated.visits || funnelData.isEstimated.carts) && (
                <span 
                  style={{ 
                    fontSize: 10, 
                    padding: "2px 6px", 
                    background: "#fff7e6", 
                    color: "#d46b08",
                    borderRadius: 4,
                    border: "1px solid #ffd591",
                  }}
                  title={isEnglish ? "Based on estimated data" : "基于估算数据"}
                >
                  {isEnglish ? "Est." : "估算"}
                </span>
              )}
            </div>
            
            {maxCount === 0 ? (
              <div style={{ 
                padding: "40px 20px", 
                textAlign: "center",
                color: "#637381",
              }}>
                <p style={{ margin: 0, fontSize: 14 }}>
                  {isEnglish ? "No data available for this period" : "该时间段内暂无数据"}
                </p>
              </div>
            ) : (
              <div style={{ padding: "20px 0" }}>
                {/* 加购放弃 */}
                <div style={{ marginBottom: 24 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>
                      {isEnglish ? "Cart Abandonment" : "加购放弃率"}
                    </span>
                    <span style={{ color: "#de3618", fontWeight: 600 }}>
                      {(Math.min(Math.max(funnelData.abandonment.cartAbandonment, 0), 1) * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <div style={{ flex: 1, height: 8, background: "#f4f6f8", borderRadius: 4, overflow: "hidden" }}>
                      <div
                        style={{
                          width: `${Math.min(Math.max(funnelData.abandonment.cartAbandonment, 0), 1) * 100}%`,
                          height: "100%",
                          background: "#de3618",
                        }}
                      />
                    </div>
                    <span style={{ fontSize: 12, color: "#635bff", whiteSpace: "nowrap" }}>
                      AI: {(Math.min(Math.max(funnelData.abandonment.aiCartAbandonment, 0), 1) * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
                
                {/* 结账放弃 */}
                <div style={{ marginBottom: 24 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>
                      {isEnglish ? "Checkout Abandonment" : "结账放弃率"}
                    </span>
                    <span style={{ color: "#f4a623", fontWeight: 600 }}>
                      {(Math.min(Math.max(funnelData.abandonment.checkoutAbandonment, 0), 1) * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <div style={{ flex: 1, height: 8, background: "#f4f6f8", borderRadius: 4, overflow: "hidden" }}>
                      <div
                        style={{
                          width: `${Math.min(Math.max(funnelData.abandonment.checkoutAbandonment, 0), 1) * 100}%`,
                          height: "100%",
                          background: "#f4a623",
                        }}
                      />
                    </div>
                    <span style={{ fontSize: 12, color: "#635bff", whiteSpace: "nowrap" }}>
                      AI: {(Math.min(Math.max(funnelData.abandonment.aiCheckoutAbandonment, 0), 1) * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
                
                {/* 总体放弃 */}
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>
                      {isEnglish ? "Total Abandonment" : "总体流失率"}
                    </span>
                    <span style={{ color: "#637381", fontWeight: 600 }}>
                      {(Math.min(Math.max(funnelData.abandonment.totalAbandonment, 0), 1) * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <div style={{ flex: 1, height: 8, background: "#f4f6f8", borderRadius: 4, overflow: "hidden" }}>
                      <div
                        style={{
                          width: `${Math.min(Math.max(funnelData.abandonment.totalAbandonment, 0), 1) * 100}%`,
                          height: "100%",
                          background: "#637381",
                        }}
                      />
                    </div>
                    <span style={{ fontSize: 12, color: "#635bff", whiteSpace: "nowrap" }}>
                      AI: {(Math.min(Math.max(1 - funnelData.conversionRates.aiVisitToOrder, 0), 1) * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>
            )}
            
            <p className={styles.helpText}>
              {isEnglish
                ? "Compare AI channel abandonment rates with overall rates to identify optimization opportunities."
                : "比较 AI 渠道与全站的放弃率，发现优化机会。"}
            </p>
          </div>
        </div>

        {/* 趋势图表 */}
        <div className={styles.card}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.sectionLabel}>{isEnglish ? "Trend" : "趋势"}</p>
              <h3 className={styles.sectionTitle}>
                {isEnglish ? "Daily Funnel Performance" : "每日漏斗表现"}
              </h3>
            </div>
          </div>
          
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{isEnglish ? "Date" : "日期"}</th>
                  <th>{isEnglish ? "Visits" : "访问"}</th>
                  <th>{isEnglish ? "Carts" : "加购"}</th>
                  <th>{isEnglish ? "Checkouts" : "结账"}</th>
                  <th>{isEnglish ? "Orders" : "订单"}</th>
                  <th>{isEnglish ? "AI Visits" : "AI 访问"}</th>
                  <th>{isEnglish ? "AI Orders" : "AI 订单"}</th>
                  <th>{isEnglish ? "AI CVR" : "AI 转化率"}</th>
                </tr>
              </thead>
              <tbody>
                {funnelData.trend.slice(-14).map((day) => (
                  <tr key={day.date}>
                    <td>{day.date}</td>
                    <td>{day.visits.toLocaleString()}</td>
                    <td>{day.carts.toLocaleString()}</td>
                    <td>{day.checkouts.toLocaleString()}</td>
                    <td>{day.orders.toLocaleString()}</td>
                    <td>{day.aiVisits.toLocaleString()}</td>
                    <td>{day.aiOrders.toLocaleString()}</td>
                    <td>
                      {day.aiVisits > 0 
                        ? ((day.aiOrders / day.aiVisits) * 100).toFixed(2) + "%"
                        : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          <p className={styles.helpText}>
            {isEnglish
              ? "Showing last 14 days. Visit/Cart data are estimates; Order data is from actual orders."
              : "显示最近 14 天。访问/加购数据为估算值；订单数据来自实际订单。"}
          </p>
        </div>

        {/* 渠道细分 */}
        <div className={styles.card}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.sectionLabel}>{isEnglish ? "By Channel" : "按渠道"}</p>
              <h3 className={styles.sectionTitle}>
                {isEnglish ? "AI Channel Performance Comparison" : "AI 渠道表现对比"}
              </h3>
            </div>
          </div>
          
          <div className={styles.tableWrap}>
            <table 
              className={styles.table}
              aria-label={isEnglish ? "AI channel performance comparison" : "AI 渠道表现对比"}
            >
              <thead>
                <tr>
                  <th>{isEnglish ? "Channel" : "渠道"}</th>
                  <th>{isEnglish ? "Visits (Est.)" : "访问（估）"}</th>
                  <th>{isEnglish ? "Checkouts" : "结账"}</th>
                  <th>{isEnglish ? "Orders" : "订单"}</th>
                  <th>{isEnglish ? "GMV" : "GMV"}</th>
                  <th>{isEnglish ? "Order CVR" : "订单转化率"}</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const filteredChannels = AI_CHANNELS.filter(channel => {
                    const data = funnelData.byChannel[channel];
                    return data && !data.every(s => s.count === 0);
                  });
                  
                  if (filteredChannels.length === 0) {
                    return (
                      <tr>
                        <td 
                          colSpan={6} 
                          style={{ textAlign: "center", color: "#637381", padding: 24 }}
                        >
                          {isEnglish ? "No AI channel data yet" : "暂无 AI 渠道数据"}
                        </td>
                      </tr>
                    );
                  }
                  
                  return filteredChannels.map(channel => {
                    const data = funnelData.byChannel[channel];
                    const visits = data.find(s => s.stage === "visit")?.count || 0;
                    const checkouts = data.find(s => s.stage === "checkout_started")?.count || 0;
                    const orders = data.find(s => s.stage === "order_created")?.count || 0;
                    const gmv = data.find(s => s.stage === "order_created")?.value || 0;
                    const orderCvr = checkouts > 0 ? orders / checkouts : 0;
                    
                    const formattedGmv = new Intl.NumberFormat(isEnglish ? "en-US" : "zh-CN", {
                      style: "currency",
                      currency,
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 0,
                    }).format(gmv);
                    
                    return (
                      <tr key={channel}>
                        <td className={styles.cellLabel}>{channel}</td>
                        <td>{visits.toLocaleString()}</td>
                        <td>{checkouts.toLocaleString()}</td>
                        <td>{orders.toLocaleString()}</td>
                        <td>{formattedGmv}</td>
                        <td>{(orderCvr * 100).toFixed(1)}%</td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
