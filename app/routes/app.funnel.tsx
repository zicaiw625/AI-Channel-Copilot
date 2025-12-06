import { useMemo, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData, useNavigate, useLocation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { getSettings } from "../lib/settings.server";
import { getFunnelData, type FunnelMetrics } from "../lib/funnelService.server";
import { useUILanguage } from "../lib/useUILanguage";
import styles from "../styles/app.dashboard.module.css";
import { channelList, timeRanges, type TimeRangeKey } from "../lib/aiData";

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

// 漏斗可视化组件
const FunnelChart = ({ 
  stages, 
  language,
  maxCount,
}: { 
  stages: FunnelMetrics[]; 
  language: string;
  maxCount: number;
}) => {
  const isEnglish = language === "English";
  
  // 检查是否有数据
  const hasData = stages.some(s => s.count > 0);
  
  if (!hasData) {
    return (
      <div style={{ 
        padding: "40px 20px", 
        textAlign: "center",
        color: "#637381",
      }}>
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
    <div style={{ padding: "20px 0" }}>
      {stages.map((stage, index) => {
        const widthPercent = maxCount > 0 ? (stage.count / maxCount) * 100 : 0;
        const nextStage = stages[index + 1];
        const dropoff = nextStage && stage.count > 0
          ? ((stage.count - nextStage.count) / stage.count * 100).toFixed(1)
          : null;
        
        return (
          <div key={stage.stage} style={{ marginBottom: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{stage.label}</span>
              <span style={{ color: "#637381", fontSize: 14 }}>
                {stage.count.toLocaleString()}
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
              >
                <span style={{ color: "#de3618", fontSize: 12 }}>↓</span>
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
}: {
  title: string;
  rate: number;
  aiRate: number;
  language: string;
}) => {
  const isEnglish = language === "English";
  const diff = aiRate - rate;
  const diffColor = diff >= 0 ? "#50b83c" : "#de3618";
  
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e0e0e0",
        borderRadius: 8,
        padding: 16,
        flex: 1,
      }}
    >
      <p style={{ margin: "0 0 8px", fontSize: 12, color: "#637381" }}>{title}</p>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 24, fontWeight: 700 }}>
          {(rate * 100).toFixed(1)}%
        </span>
        <span style={{ fontSize: 12, color: "#637381" }}>
          {isEnglish ? "Overall" : "全站"}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
        <span style={{ fontSize: 18, fontWeight: 600, color: "#635bff" }}>
          {(aiRate * 100).toFixed(1)}%
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
    </div>
  );
};

export default function FunnelAnalysis() {
  const { funnelData, language, rangeKey, shopDomain: _shopDomain, currency: _currency } = useLoaderData<typeof loader>();
  const uiLanguage = useUILanguage(language);
  const isEnglish = uiLanguage === "English";
  const navigate = useNavigate();
  const location = useLocation();
  
  const [selectedChannel, setSelectedChannel] = useState<string>("all");
  
  const maxCount = useMemo(() => {
    return Math.max(
      ...funnelData.overall.map(s => s.count),
      ...funnelData.aiChannels.map(s => s.count),
    );
  }, [funnelData]);
  
  const selectedFunnel = useMemo(() => {
    if (selectedChannel === "all") return funnelData.overall;
    if (selectedChannel === "ai") return funnelData.aiChannels;
    return funnelData.byChannel[selectedChannel] || funnelData.overall;
  }, [selectedChannel, funnelData]);
  
  const setRange = (value: TimeRangeKey) => {
    const params = new URLSearchParams(location.search);
    params.set("range", value);
    navigate({ search: `?${params.toString()}` });
  };

  return (
    <s-page heading={isEnglish ? "Funnel Analysis" : "漏斗分析"}>
      <div className={styles.page}>
        {/* 顶部导航 */}
        <div style={{ marginBottom: 16, display: "flex", gap: 12, justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 12 }}>
            <Link to="/app" className={styles.secondaryButton}>
              ← {isEnglish ? "Back to Dashboard" : "返回仪表盘"}
            </Link>
            <Link to="/app/optimization" className={styles.primaryButton}>
              {isEnglish ? "AI Optimization Tips" : "AI 优化建议"} →
            </Link>
          </div>
          
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

        {/* 说明 */}
        <div className={styles.card}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.sectionLabel}>{isEnglish ? "Funnel Attribution" : "漏斗归因"}</p>
              <h3 className={styles.sectionTitle}>
                {isEnglish ? "Visit → Add to Cart → Checkout → Order" : "访问 → 加购 → 结账 → 成交"}
              </h3>
            </div>
            <span className={styles.badge}>
              {isEnglish ? "Beta" : "测试版"}
            </span>
          </div>
          <p className={styles.helpText}>
            {isEnglish
              ? "Track how AI-referred visitors convert through your purchase funnel. Note: Visit and Add-to-Cart data are estimates based on checkout/order patterns. Enable checkout webhooks for more accurate data."
              : "追踪 AI 引荐访客在购买漏斗中的转化情况。注意：访问和加购数据是基于结账/订单模式的估算。启用 checkout webhook 可获得更准确的数据。"}
          </p>
        </div>

        {/* 转化率概览 */}
        <div style={{ display: "flex", gap: 16, marginBottom: 24 }}>
          <ConversionCard
            title={isEnglish ? "Visit → Cart" : "访问 → 加购"}
            rate={funnelData.conversionRates.visitToCart}
            aiRate={funnelData.conversionRates.aiVisitToCart}
            language={uiLanguage}
          />
          <ConversionCard
            title={isEnglish ? "Cart → Checkout" : "加购 → 结账"}
            rate={funnelData.conversionRates.cartToCheckout}
            aiRate={funnelData.conversionRates.aiCartToCheckout}
            language={uiLanguage}
          />
          <ConversionCard
            title={isEnglish ? "Checkout → Order" : "结账 → 订单"}
            rate={funnelData.conversionRates.checkoutToOrder}
            aiRate={funnelData.conversionRates.aiCheckoutToOrder}
            language={uiLanguage}
          />
          <ConversionCard
            title={isEnglish ? "Visit → Order" : "访问 → 订单"}
            rate={funnelData.conversionRates.visitToOrder}
            aiRate={funnelData.conversionRates.aiVisitToOrder}
            language={uiLanguage}
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
              >
                <option value="all">{isEnglish ? "All Traffic" : "全部流量"}</option>
                <option value="ai">{isEnglish ? "AI Channels (Total)" : "AI 渠道（汇总）"}</option>
                {channelList.map(channel => (
                  <option key={channel} value={channel}>{channel}</option>
                ))}
              </select>
            </div>
            
            <FunnelChart
              stages={selectedFunnel}
              language={uiLanguage}
              maxCount={maxCount}
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
                      {(funnelData.abandonment.cartAbandonment * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <div style={{ flex: 1, height: 8, background: "#f4f6f8", borderRadius: 4, overflow: "hidden" }}>
                      <div
                        style={{
                          width: `${funnelData.abandonment.cartAbandonment * 100}%`,
                          height: "100%",
                          background: "#de3618",
                        }}
                      />
                    </div>
                    <span style={{ fontSize: 12, color: "#635bff" }}>
                      AI: {(funnelData.abandonment.aiCartAbandonment * 100).toFixed(1)}%
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
                      {(funnelData.abandonment.checkoutAbandonment * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <div style={{ flex: 1, height: 8, background: "#f4f6f8", borderRadius: 4, overflow: "hidden" }}>
                      <div
                        style={{
                          width: `${funnelData.abandonment.checkoutAbandonment * 100}%`,
                          height: "100%",
                          background: "#f4a623",
                        }}
                      />
                    </div>
                    <span style={{ fontSize: 12, color: "#635bff" }}>
                      AI: {(funnelData.abandonment.aiCheckoutAbandonment * 100).toFixed(1)}%
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
                      {(funnelData.abandonment.totalAbandonment * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div style={{ height: 8, background: "#f4f6f8", borderRadius: 4, overflow: "hidden" }}>
                    <div
                      style={{
                        width: `${funnelData.abandonment.totalAbandonment * 100}%`,
                        height: "100%",
                        background: "#637381",
                      }}
                    />
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
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{isEnglish ? "Channel" : "渠道"}</th>
                  <th>{isEnglish ? "Visits (Est.)" : "访问（估）"}</th>
                  <th>{isEnglish ? "Checkouts" : "结账"}</th>
                  <th>{isEnglish ? "Orders" : "订单"}</th>
                  <th>{isEnglish ? "GMV" : "GMV"}</th>
                  <th>{isEnglish ? "Checkout CVR" : "结账转化率"}</th>
                </tr>
              </thead>
              <tbody>
                {channelList.map(channel => {
                  const data = funnelData.byChannel[channel];
                  if (!data || data.every(s => s.count === 0)) return null;
                  
                  const visits = data.find(s => s.stage === "visit")?.count || 0;
                  const checkouts = data.find(s => s.stage === "checkout_started")?.count || 0;
                  const orders = data.find(s => s.stage === "order_created")?.count || 0;
                  const gmv = data.find(s => s.stage === "order_created")?.value || 0;
                  const cvr = checkouts > 0 ? orders / checkouts : 0;
                  
                  return (
                    <tr key={channel}>
                      <td className={styles.cellLabel}>{channel}</td>
                      <td>{visits.toLocaleString()}</td>
                      <td>{checkouts.toLocaleString()}</td>
                      <td>{orders.toLocaleString()}</td>
                      <td>${gmv.toLocaleString()}</td>
                      <td>{(cvr * 100).toFixed(1)}%</td>
                    </tr>
                  );
                })}
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
