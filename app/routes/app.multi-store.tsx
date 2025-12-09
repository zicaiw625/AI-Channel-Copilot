import { useMemo } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { getSettings } from "../lib/settings.server";
import { useUILanguage } from "../lib/useUILanguage";
import styles from "../styles/app.dashboard.module.css";
import { requireFeature, FEATURES } from "../lib/access.server";
import { OrdersRepository } from "../lib/repositories/orders.repository";
import { resolveDateRange } from "../lib/aiData";
import { logger } from "../lib/logger.server";
import prisma from "../db.server";

// ============================================================================
// Types
// ============================================================================

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
}

interface MultiStoreData {
  stores: StoreSnapshot[];
  totals: {
    totalOrders: number;
    totalGMV: number;
    aiOrders: number;
    aiGMV: number;
    aiShare: number;
  };
  linkedStores: string[];
}

// ============================================================================
// Loader
// ============================================================================

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  
  // 检查 Growth 权限
  await requireFeature(shopDomain, FEATURES.MULTI_STORE);
  
  const settings = await getSettings(shopDomain);
  const language = settings.languages?.[0] || "中文";

  // 查找同一用户的所有店铺（基于 Session 表中的 email 或 userId）
  let linkedShops: string[] = [shopDomain];
  
  try {
    // 获取当前 session 的用户信息
    const currentSession = await prisma.session.findFirst({
      where: { shop: shopDomain },
      select: { email: true, userId: true },
    });
    
    if (currentSession?.email) {
      // 查找同一邮箱关联的所有店铺
      const linkedSessions = await prisma.session.findMany({
        where: { 
          email: currentSession.email,
          NOT: { shop: shopDomain },
        },
        select: { shop: true },
        distinct: ["shop"],
      });
      
      linkedShops = [
        shopDomain, 
        ...linkedSessions.map(s => s.shop),
      ];
    }
  } catch (e) {
    logger.warn("[multi-store] Failed to find linked shops", { shopDomain }, { error: e });
  }

  // 获取所有关联店铺的数据
  const ordersRepo = new OrdersRepository();
  const range = resolveDateRange("30d");
  
  const storeSnapshots: StoreSnapshot[] = [];
  
  for (const shop of linkedShops) {
    try {
      const shopSettings = await getSettings(shop);
      const stats = await ordersRepo.getAggregateStats(shop, range);
      
      // 获取最近订单时间
      const lastOrder = await prisma.order.findFirst({
        where: { shopDomain: shop },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      
      storeSnapshots.push({
        shopDomain: shop,
        displayName: shop.replace(".myshopify.com", ""),
        totalOrders: stats.total.orders,
        totalGMV: stats.total.gmv,
        aiOrders: stats.ai.orders,
        aiGMV: stats.ai.gmv,
        aiShare: stats.total.gmv > 0 ? (stats.ai.gmv / stats.total.gmv) * 100 : 0,
        currency: shopSettings.primaryCurrency || "USD",
        lastOrderAt: lastOrder?.createdAt.toISOString() || null,
      });
    } catch (e) {
      logger.warn("[multi-store] Failed to load shop data", { shop }, { error: e });
      // 添加一个空的快照
      storeSnapshots.push({
        shopDomain: shop,
        displayName: shop.replace(".myshopify.com", ""),
        totalOrders: 0,
        totalGMV: 0,
        aiOrders: 0,
        aiGMV: 0,
        aiShare: 0,
        currency: "USD",
        lastOrderAt: null,
      });
    }
  }

  // 计算总计
  const totals = storeSnapshots.reduce(
    (acc, store) => ({
      totalOrders: acc.totalOrders + store.totalOrders,
      totalGMV: acc.totalGMV + store.totalGMV,
      aiOrders: acc.aiOrders + store.aiOrders,
      aiGMV: acc.aiGMV + store.aiGMV,
      aiShare: 0, // 将在后面计算
    }),
    { totalOrders: 0, totalGMV: 0, aiOrders: 0, aiGMV: 0, aiShare: 0 }
  );
  
  totals.aiShare = totals.totalGMV > 0 ? (totals.aiGMV / totals.totalGMV) * 100 : 0;

  return {
    language,
    shopDomain,
    data: {
      stores: storeSnapshots,
      totals,
      linkedStores: linkedShops,
    } as MultiStoreData,
  };
};

// ============================================================================
// Components
// ============================================================================

function StoreCard({
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
  return (
    <div
      style={{
        background: isCurrent ? "linear-gradient(135deg, #f6ffed 0%, #e6f7ed 100%)" : "#fff",
        border: isCurrent ? "2px solid #52c41a" : "1px solid #e0e0e0",
        borderRadius: 12,
        padding: 20,
        position: "relative",
      }}
    >
      {isCurrent && (
        <span
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            background: "#52c41a",
            color: "#fff",
            padding: "2px 8px",
            borderRadius: 12,
            fontSize: 11,
            fontWeight: 500,
          }}
        >
          {en ? "Current" : "当前"}
        </span>
      )}
      
      <div style={{ marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: "#212b36" }}>
          {store.displayName}
        </h3>
        <p style={{ margin: "4px 0 0", fontSize: 12, color: "#919eab" }}>
          {store.shopDomain}
        </p>
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
          <span style={{ fontSize: 12, fontWeight: 600, color: "#635bff" }}>
            {store.aiShare.toFixed(1)}%
          </span>
        </div>
        <div style={{ 
          height: 6, 
          background: "#f4f6f8", 
          borderRadius: 3,
          overflow: "hidden",
        }}>
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
    </div>
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
    <div
      style={{
        background: highlight ? "#f0f4ff" : "#f9fafb",
        padding: 12,
        borderRadius: 8,
      }}
    >
      <div style={{ fontSize: 11, color: "#919eab", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: highlight ? "#635bff" : "#212b36" }}>
        {value}
      </div>
      {subValue && (
        <div style={{ fontSize: 11, color: "#637381", marginTop: 2 }}>{subValue}</div>
      )}
    </div>
  );
}

function TotalsSummary({
  totals,
  storeCount,
  en,
  formatCurrency,
}: {
  totals: MultiStoreData["totals"];
  storeCount: number;
  en: boolean;
  formatCurrency: (amount: number) => string;
}) {
  return (
    <div
      style={{
        background: "linear-gradient(135deg, #f0f7ff 0%, #e6f4ff 100%)",
        border: "1px solid #91caff",
        borderRadius: 12,
        padding: 24,
        marginBottom: 24,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <span style={{ fontSize: 24 }}>🏪</span>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#0958d9" }}>
            {en ? "Multi-Store Overview" : "多店铺汇总"}
          </h2>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "#637381" }}>
            {en 
              ? `Aggregated data from ${storeCount} store${storeCount > 1 ? "s" : ""} (Last 30 days)`
              : `${storeCount} 个店铺的汇总数据（最近 30 天）`}
          </p>
        </div>
      </div>
      
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        <SummaryCard
          icon="💰"
          label={en ? "Total GMV" : "总 GMV"}
          value={formatCurrency(totals.totalGMV)}
          subValue={`${totals.totalOrders} ${en ? "orders" : "订单"}`}
        />
        <SummaryCard
          icon="🤖"
          label={en ? "AI GMV" : "AI GMV"}
          value={formatCurrency(totals.aiGMV)}
          subValue={`${totals.aiOrders} ${en ? "orders" : "订单"}`}
          highlight
        />
        <SummaryCard
          icon="📊"
          label={en ? "AI Share" : "AI 占比"}
          value={`${totals.aiShare.toFixed(1)}%`}
          subValue={en ? "of total GMV" : "占总 GMV"}
        />
        <SummaryCard
          icon="🏪"
          label={en ? "Stores" : "店铺数"}
          value={storeCount.toString()}
          subValue={en ? "connected" : "已连接"}
        />
      </div>
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
    <div
      style={{
        background: highlight ? "rgba(99, 91, 255, 0.1)" : "rgba(255, 255, 255, 0.8)",
        padding: 16,
        borderRadius: 8,
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 24, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontSize: 11, color: "#637381", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: highlight ? "#635bff" : "#212b36" }}>
        {value}
      </div>
      {subValue && (
        <div style={{ fontSize: 11, color: "#919eab", marginTop: 2 }}>{subValue}</div>
      )}
    </div>
  );
}

function AddStorePrompt({ en }: { en: boolean }) {
  return (
    <div
      style={{
        background: "#f9fafb",
        border: "2px dashed #c4cdd5",
        borderRadius: 12,
        padding: 32,
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 48, marginBottom: 12 }}>➕</div>
      <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 600, color: "#212b36" }}>
        {en ? "Connect More Stores" : "连接更多店铺"}
      </h3>
      <p style={{ margin: "0 0 16px", fontSize: 14, color: "#637381" }}>
        {en
          ? "Install AI Channel Copilot on your other Shopify stores using the same account email to see aggregated data here."
          : "在您的其他 Shopify 店铺上安装 AI Channel Copilot（使用相同的账户邮箱），即可在此查看汇总数据。"}
      </p>
      <a
        href="https://apps.shopify.com/ai-channel-copilot"
        target="_blank"
        rel="noreferrer"
        style={{
          display: "inline-block",
          padding: "10px 20px",
          background: "#008060",
          color: "#fff",
          borderRadius: 6,
          fontSize: 14,
          fontWeight: 600,
          textDecoration: "none",
        }}
      >
        {en ? "Install on Another Store" : "在其他店铺安装"}
      </a>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function MultiStore() {
  const { language, shopDomain, data } = useLoaderData<typeof loader>();
  const uiLanguage = useUILanguage(language);
  const en = uiLanguage === "English";

  const formatCurrency = useMemo(() => {
    return (amount: number, currency = "USD") => {
      return new Intl.NumberFormat(en ? "en-US" : "zh-CN", {
        style: "currency",
        currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(amount);
    };
  }, [en]);

  return (
    <s-page heading={en ? "Multi-Store Overview" : "多店铺汇总"}>
      <div className={styles.page}>
        {/* 顶部导航 */}
        <div style={{ marginBottom: 16, display: "flex", gap: 12 }}>
          <Link to="/app" className={styles.secondaryButton}>
            ← {en ? "Back to Dashboard" : "返回仪表盘"}
          </Link>
        </div>

        {/* Growth 功能标识 */}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 12px",
            background: "#f6ffed",
            border: "1px solid #b7eb8f",
            borderRadius: 20,
            marginBottom: 20,
            fontSize: 13,
            color: "#389e0d",
            fontWeight: 500,
          }}
        >
          ✨ {en ? "Growth Plan Feature" : "Growth 版功能"}
        </div>

        {/* 汇总概览 */}
        <TotalsSummary
          totals={data.totals}
          storeCount={data.stores.length}
          en={en}
          formatCurrency={(amount) => formatCurrency(amount, "USD")}
        />

        {/* 店铺列表 */}
        <div className={styles.card}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.sectionLabel}>{en ? "Connected Stores" : "已连接店铺"}</p>
              <h3 className={styles.sectionTitle}>
                {en ? "Store Performance Comparison" : "店铺表现对比"}
              </h3>
            </div>
            <span className={styles.badge}>
              {data.stores.length} {en ? (data.stores.length === 1 ? "store" : "stores") : "个店铺"}
            </span>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
              gap: 16,
              marginTop: 16,
            }}
          >
            {data.stores.map((store) => (
              <StoreCard
                key={store.shopDomain}
                store={store}
                en={en}
                formatCurrency={formatCurrency}
                isCurrent={store.shopDomain === shopDomain}
              />
            ))}
            
            {/* 添加更多店铺提示 */}
            <AddStorePrompt en={en} />
          </div>
        </div>

        {/* 说明 */}
        <div
          style={{
            marginTop: 20,
            padding: 16,
            background: "#fffbe6",
            border: "1px solid #ffe58f",
            borderRadius: 8,
            fontSize: 13,
            color: "#614700",
          }}
        >
          <strong>💡 {en ? "How it works:" : "工作原理："}</strong>{" "}
          {en
            ? "Stores are automatically linked when you install the app using the same Shopify account email. Data is aggregated from all linked stores for the last 30 days."
            : "当您使用相同的 Shopify 账户邮箱安装应用时，店铺会自动关联。数据汇总自所有关联店铺的最近 30 天。"}
        </div>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

