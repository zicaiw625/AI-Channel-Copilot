import { Link, useLocation } from "react-router";

import { Banner, Button, Card, EmptyState, StatusBadge } from "../ui";
import { buildEmbeddedAppPath } from "../../lib/navigation";

interface StoreSnapshot {
  shopDomain: string;
  displayName: string;
  totalOrders: number;
  totalGMV: number;
  aiOrders: number;
  aiGMV: number;
  aiShare: number;
  currency: string;
  lastOrderAt: string | null;
  loadError?: boolean;
}

interface CurrencyTotals {
  currency: string;
  totalOrders: number;
  totalGMV: number;
  aiOrders: number;
  aiGMV: number;
  aiShare: number;
  storeCount: number;
}

export function StoreCard({
  store,
  en,
  formatCurrency,
  isCurrent,
}: {
  store: StoreSnapshot;
  en: boolean;
  formatCurrency: (amount: number, currency: string) => string;
  isCurrent: boolean;
}) {
  if (store.loadError) {
    return (
      <Card
        padding="tight"
        style={{
          background: "#fff2f0",
          border: "1px solid #ffccc7",
          position: "relative",
        }}
      >
        {isCurrent && (
          <StatusBadge tone="success" style={{ position: "absolute", top: 12, right: 12, fontSize: 11 }}>
            {en ? "Current" : "当前"}
          </StatusBadge>
        )}

        <div style={{ marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: "#212b36" }}>{store.displayName}</h3>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "#919eab" }}>{store.shopDomain}</p>
        </div>

        <Banner status="critical" title={en ? "Failed to load store data" : "店铺数据加载失败"}>
          {en ? "Please try refreshing the page." : "请尝试刷新页面。"}
        </Banner>
      </Card>
    );
  }

  return (
    <Card
      padding="tight"
      style={{
        background: isCurrent ? "linear-gradient(135deg, #f6ffed 0%, #e6f7ed 100%)" : "#fff",
        border: isCurrent ? "2px solid #52c41a" : "1px solid #e0e0e0",
        position: "relative",
      }}
    >
      {isCurrent && (
        <StatusBadge tone="success" style={{ position: "absolute", top: 12, right: 12, fontSize: 11 }}>
          {en ? "Current" : "当前"}
        </StatusBadge>
      )}

      <div style={{ marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: "#212b36" }}>{store.displayName}</h3>
        <p style={{ margin: "4px 0 0", fontSize: 12, color: "#919eab" }}>{store.shopDomain}</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <MetricBox
          label={en ? "Total GMV" : "总 GMV"}
          value={formatCurrency(store.totalGMV, store.currency)}
          subValue={`${store.totalOrders} ${en ? "orders" : "订单"}`}
        />
        <MetricBox
          label={en ? "AI GMV" : "AI GMV"}
          value={formatCurrency(store.aiGMV, store.currency)}
          subValue={`${store.aiOrders} ${en ? "orders" : "订单"}`}
          highlight
        />
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontSize: 12, color: "#637381" }}>{en ? "AI Share" : "AI 占比"}</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#635bff" }}>{store.aiShare.toFixed(1)}%</span>
        </div>
        <div style={{ height: 6, background: "#f4f6f8", borderRadius: 3, overflow: "hidden" }}>
          <div
            style={{
              width: `${Math.min(store.aiShare, 100)}%`,
              height: "100%",
              background: "#635bff",
              borderRadius: 3,
            }}
          />
        </div>
      </div>

      {store.lastOrderAt && (
        <p style={{ margin: "12px 0 0", fontSize: 11, color: "#919eab" }}>
          {en ? "Last order: " : "最后订单："}
          {new Date(store.lastOrderAt).toLocaleDateString()}
        </p>
      )}
    </Card>
  );
}

function MetricBox({
  label,
  value,
  subValue,
  highlight = false,
}: {
  label: string;
  value: string;
  subValue?: string;
  highlight?: boolean;
}) {
  return (
    <div style={{ background: highlight ? "#f0f4ff" : "#f9fafb", padding: 12, borderRadius: 8 }}>
      <div style={{ fontSize: 11, color: "#919eab", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: highlight ? "#635bff" : "#212b36" }}>{value}</div>
      {subValue && <div style={{ fontSize: 11, color: "#637381", marginTop: 2 }}>{subValue}</div>}
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  subValue,
  highlight = false,
}: {
  icon: string;
  label: string;
  value: string;
  subValue?: string;
  highlight?: boolean;
}) {
  return (
    <div style={{ background: highlight ? "rgba(99, 91, 255, 0.1)" : "rgba(255, 255, 255, 0.8)", padding: 16, borderRadius: 8, textAlign: "center" }}>
      <div style={{ fontSize: 24, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontSize: 11, color: "#637381", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: highlight ? "#635bff" : "#212b36" }}>{value}</div>
      {subValue && <div style={{ fontSize: 11, color: "#919eab", marginTop: 2 }}>{subValue}</div>}
    </div>
  );
}

export function TotalsSummary({
  totalsByCurrency,
  aggregateOrders,
  storeCount,
  errorCount,
  en,
  formatCurrency,
}: {
  totalsByCurrency: CurrencyTotals[];
  aggregateOrders: { totalOrders: number; aiOrders: number };
  storeCount: number;
  errorCount: number;
  en: boolean;
  formatCurrency: (amount: number, currency: string) => string;
}) {
  const primaryCurrency = totalsByCurrency[0];
  // AI 占比在本模块的语义是「金额占比（of total GMV）」，因此使用 primaryCurrency 口径。
  const overallAiShare = primaryCurrency ? primaryCurrency.aiShare : 0;

  return (
    <Card
      padding="tight"
      style={{
        background: "linear-gradient(135deg, #f0f7ff 0%, #e6f4ff 100%)",
        border: "1px solid #91caff",
        marginBottom: 24,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <span style={{ fontSize: 24 }}>🏪</span>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#0958d9" }}>{en ? "Multi-Store Overview" : "多店铺汇总"}</h2>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "#637381" }}>
            {en ? `Aggregated data from ${storeCount} store${storeCount > 1 ? "s" : ""} (Last 30 days)` : `${storeCount} 个店铺的汇总数据（最近 30 天）`}
          </p>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        <SummaryCard
          icon="💰"
          label={en ? "Total GMV" : "总 GMV"}
          value={primaryCurrency ? formatCurrency(primaryCurrency.totalGMV, primaryCurrency.currency) : formatCurrency(0, "USD")}
          subValue={`${aggregateOrders.totalOrders} ${en ? "orders" : "订单"}`}
        />
        <SummaryCard
          icon="🤖"
          label={en ? "AI GMV" : "AI GMV"}
          value={primaryCurrency ? formatCurrency(primaryCurrency.aiGMV, primaryCurrency.currency) : formatCurrency(0, "USD")}
          subValue={`${aggregateOrders.aiOrders} ${en ? "orders" : "订单"}`}
          highlight
        />
        <SummaryCard
          icon="📊"
          label={en ? "AI Share" : "AI 占比"}
          value={`${overallAiShare.toFixed(1)}%`}
          subValue={en ? "of total GMV" : "占总 GMV"}
        />
        <SummaryCard
          icon="🏪"
          label={en ? "Stores" : "店铺数"}
          value={storeCount.toString()}
          subValue={en ? "connected" : "已连接"}
        />
      </div>

      {totalsByCurrency.length > 1 && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid #91caff" }}>
          <p style={{ margin: "0 0 12px", fontSize: 12, color: "#637381", fontWeight: 500 }}>
            {en ? "Breakdown by Currency" : "按货币分组"}
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {totalsByCurrency.map((group) => (
              <div key={group.currency} style={{ background: "rgba(255, 255, 255, 0.7)", padding: "8px 12px", borderRadius: 8, fontSize: 13 }}>
                <span style={{ fontWeight: 600, color: "#212b36" }}>{formatCurrency(group.totalGMV, group.currency)}</span>
                <span style={{ color: "#637381", marginLeft: 6 }}>
                  ({group.storeCount} {en ? (group.storeCount === 1 ? "store" : "stores") : "店铺"})
                </span>
                <span style={{ color: "#635bff", marginLeft: 8, fontWeight: 500 }}>
                  AI: {group.aiShare.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {errorCount > 0 && (
        <div style={{ marginTop: 16 }}>
          <Banner status="critical">
            {en ? `${errorCount} store${errorCount > 1 ? "s" : ""} failed to load data` : `${errorCount} 个店铺数据加载失败`}
          </Banner>
        </div>
      )}
    </Card>
  );
}

export function AddStorePrompt({ en }: { en: boolean }) {
  return (
    <EmptyState
      icon="➕"
      title={en ? "Connect More Stores" : "连接更多店铺"}
      description={en
        ? "Install AI Attribution for Shopify on your other Shopify stores using the same account email to see aggregated data here."
        : "在您的其他 Shopify 店铺上安装 AI Attribution for Shopify（使用相同的账户邮箱），即可在此查看汇总数据。"}
      dashed
      action={(
        <a href="https://apps.shopify.com/AI-Attribution-for-Shopify" target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
          <Button variant="primary" size="medium">
            {en ? "Install on Another Store" : "在其他店铺安装"}
          </Button>
        </a>
      )}
    />
  );
}

export function MultiStoreUpgradePrompt({ en }: { en: boolean }) {
  const location = useLocation();
  const billingHref = buildEmbeddedAppPath("/app/billing", location.search, { backTo: null, fromTab: null, tab: null });

  return (
    <div
      style={{
        background: "linear-gradient(135deg, #f6ffed 0%, #e6f7ed 100%)",
        border: "1px solid #b7eb8f",
        borderRadius: 16,
        padding: 48,
        textAlign: "center",
        maxWidth: 600,
        margin: "40px auto",
      }}
    >
      <div style={{ fontSize: 64, marginBottom: 20 }}>🏪</div>
      <h2 style={{ fontSize: 28, fontWeight: 700, color: "#212b36", margin: "0 0 12px" }}>
        {en ? "Multi-Store Overview" : "多店铺汇总"}
      </h2>
      <p style={{ fontSize: 16, color: "#637381", marginBottom: 24, lineHeight: 1.6 }}>
        {en
          ? "Aggregate and compare data across all your Shopify stores in one dashboard. See combined AI attribution, GMV, and performance metrics."
          : "在一个仪表盘中汇总和对比您所有 Shopify 店铺的数据。查看合并的 AI 归因、GMV 和表现指标。"}
      </p>

      <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", marginBottom: 24 }}>
        {[
          { icon: "📊", text: en ? "Combined Analytics" : "合并分析" },
          { icon: "🔄", text: en ? "Cross-Store Comparison" : "跨店对比" },
          { icon: "🤖", text: en ? "AI Attribution Summary" : "AI 归因汇总" },
        ].map((feature) => (
          <div
            key={feature.text}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 16px",
              background: "#fff",
              borderRadius: 20,
              fontSize: 13,
              color: "#212b36",
              border: "1px solid #e0e0e0",
            }}
          >
            <span>{feature.icon}</span>
            <span>{feature.text}</span>
          </div>
        ))}
      </div>

      <div style={{ background: "#fff", border: "1px solid #b7eb8f", borderRadius: 12, padding: 20, marginBottom: 24 }}>
        <div style={{ fontSize: 13, color: "#389e0d", fontWeight: 600, marginBottom: 8 }}>
          ✨ {en ? "Requires Growth" : "需要 Growth 版"}
        </div>
        <div style={{ fontSize: 14, color: "#637381" }}>
          {en
            ? "Upgrade to Growth to unlock multi-store management and more advanced features."
            : "升级到 Growth 版解锁多店铺管理和更多高级功能。"}
        </div>
      </div>

      <Link
        to={billingHref}
        style={{
          display: "inline-block",
          padding: "14px 32px",
          background: "linear-gradient(135deg, #52c41a 0%, #389e0d 100%)",
          color: "#fff",
          borderRadius: 8,
          fontSize: 16,
          fontWeight: 600,
          textDecoration: "none",
          boxShadow: "0 4px 12px rgba(82, 196, 26, 0.3)",
        }}
      >
        {en ? "Upgrade to Growth →" : "升级到 Growth 版 →"}
      </Link>
    </div>
  );
}
