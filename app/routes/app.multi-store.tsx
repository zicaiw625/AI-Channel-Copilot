import { useMemo } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { getSettings } from "../lib/settings.server";
import { useUILanguage } from "../lib/useUILanguage";
import styles from "../styles/app.dashboard.module.css";
import { hasFeature, FEATURES } from "../lib/access.server";
import { ordersRepository } from "../lib/repositories/orders.repository";
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
  loadError?: boolean; // 标记是否加载失败
}

// 按货币分组的汇总数据
interface CurrencyTotals {
  currency: string;
  totalOrders: number;
  totalGMV: number;
  aiOrders: number;
  aiGMV: number;
  aiShare: number;
  storeCount: number;
}

interface MultiStoreData {
  stores: StoreSnapshot[];
  // 按货币分组的汇总，而非简单相加
  totalsByCurrency: CurrencyTotals[];
  // 总订单数（可以跨货币相加）
  aggregateOrders: {
    totalOrders: number;
    aiOrders: number;
  };
  linkedStores: string[];
  storeCount: number;
  errorCount: number; // 加载失败的店铺数
}

// ============================================================================
// Loader
// ============================================================================

import type { DateRange } from "../lib/aiTypes";

// 获取单个店铺数据的辅助函数
async function fetchStoreData(
  shop: string,
  range: DateRange
): Promise<StoreSnapshot> {
  const [shopSettings, stats, lastOrder] = await Promise.all([
    getSettings(shop),
    ordersRepository.getAggregateStats(shop, range),
    prisma.order.findFirst({
      where: { shopDomain: shop },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);

  return {
    shopDomain: shop,
    displayName: shop.replace(".myshopify.com", ""),
    totalOrders: stats.total.orders,
    totalGMV: stats.total.gmv,
    aiOrders: stats.ai.orders,
    aiGMV: stats.ai.gmv,
    aiShare: stats.total.gmv > 0 ? (stats.ai.gmv / stats.total.gmv) * 100 : 0,
    currency: shopSettings.primaryCurrency || "USD",
    lastOrderAt: lastOrder?.createdAt.toISOString() || null,
    loadError: false,
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  
  // 检查 Growth 权限（不阻止访问，但显示升级提示）
  const isGrowth = await hasFeature(shopDomain, FEATURES.MULTI_STORE);
  
  const settings = await getSettings(shopDomain);
  const language = settings.languages?.[0] || "中文";

  // 如果不是 Growth 用户，提前返回空数据
  if (!isGrowth) {
    return {
      language,
      shopDomain,
      isGrowth,
      data: {
        stores: [],
        totalsByCurrency: [],
        aggregateOrders: { totalOrders: 0, aiOrders: 0 },
        linkedStores: [],
        storeCount: 0,
        errorCount: 0,
      } as MultiStoreData,
    };
  }

  // 查找同一用户的所有店铺（基于 Session 表中的 email）
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

  // 【优化】并行获取所有关联店铺的数据
  const range = resolveDateRange("30d");
  
  const storeResults = await Promise.allSettled(
    linkedShops.map(shop => fetchStoreData(shop, range))
  );
      
  // 处理结果，区分成功和失败
  const storeSnapshots: StoreSnapshot[] = storeResults.map((result, index) => {
    const shop = linkedShops[index];
    
    if (result.status === "fulfilled") {
      return result.value;
    } else {
      // 记录错误，返回带错误标记的空快照
      logger.warn("[multi-store] Failed to load shop data", { shop }, { error: result.reason });
      return {
        shopDomain: shop,
        displayName: shop.replace(".myshopify.com", ""),
        totalOrders: 0,
        totalGMV: 0,
        aiOrders: 0,
        aiGMV: 0,
        aiShare: 0,
        currency: "USD",
        lastOrderAt: null,
        loadError: true,
      };
    }
  });

  // 统计加载失败的店铺数
  const errorCount = storeSnapshots.filter(s => s.loadError).length;
  
  // 【修复】按货币分组计算汇总，而非简单相加不同货币
  const currencyMap = new Map<string, CurrencyTotals>();
  
  for (const store of storeSnapshots) {
    if (store.loadError) continue; // 跳过加载失败的店铺
    
    const existing = currencyMap.get(store.currency);
    if (existing) {
      existing.totalOrders += store.totalOrders;
      existing.totalGMV += store.totalGMV;
      existing.aiOrders += store.aiOrders;
      existing.aiGMV += store.aiGMV;
      existing.storeCount += 1;
    } else {
      currencyMap.set(store.currency, {
        currency: store.currency,
        totalOrders: store.totalOrders,
        totalGMV: store.totalGMV,
        aiOrders: store.aiOrders,
        aiGMV: store.aiGMV,
        aiShare: 0,
        storeCount: 1,
      });
    }
  }

  // 计算每个货币组的 AI 占比
  const totalsByCurrency = Array.from(currencyMap.values()).map(group => ({
    ...group,
    aiShare: group.totalGMV > 0 ? (group.aiGMV / group.totalGMV) * 100 : 0,
  }));
  
  // 按 GMV 降序排序
  totalsByCurrency.sort((a, b) => b.totalGMV - a.totalGMV);

  // 订单数可以跨货币相加
  const aggregateOrders = {
    totalOrders: storeSnapshots.filter(s => !s.loadError).reduce((sum, s) => sum + s.totalOrders, 0),
    aiOrders: storeSnapshots.filter(s => !s.loadError).reduce((sum, s) => sum + s.aiOrders, 0),
  };

  return {
    language,
    shopDomain,
    isGrowth,
    data: {
      stores: storeSnapshots,
      totalsByCurrency,
      aggregateOrders,
      linkedStores: linkedShops,
      storeCount: storeSnapshots.filter(s => !s.loadError).length,
      errorCount,
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
  // 加载失败状态
  if (store.loadError) {
    return (
      <div
        style={{
          background: "#fff2f0",
          border: "1px solid #ffccc7",
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
        
        <div
          style={{
            padding: 16,
            background: "rgba(255, 77, 79, 0.1)",
            borderRadius: 8,
            textAlign: "center",
          }}
        >
          <span style={{ fontSize: 24, display: "block", marginBottom: 8 }}>⚠️</span>
          <p style={{ margin: 0, fontSize: 13, color: "#a8071a" }}>
            {en ? "Failed to load store data" : "店铺数据加载失败"}
          </p>
          <p style={{ margin: "8px 0 0", fontSize: 12, color: "#ff7875" }}>
            {en ? "Please try refreshing the page" : "请尝试刷新页面"}
          </p>
        </div>
      </div>
    );
  }
  
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
  // 计算综合 AI 占比（基于所有货币的订单数）
  const overallAiShare = aggregateOrders.totalOrders > 0 
    ? (aggregateOrders.aiOrders / aggregateOrders.totalOrders) * 100 
    : 0;
  
  // 取主要货币（GMV 最高的）用于显示
  const primaryCurrency = totalsByCurrency[0];
  
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
      
      {/* 如果有多种货币，显示分货币汇总 */}
      {totalsByCurrency.length > 1 && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid #91caff" }}>
          <p style={{ margin: "0 0 12px", fontSize: 12, color: "#637381", fontWeight: 500 }}>
            {en ? "Breakdown by Currency" : "按货币分组"}
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {totalsByCurrency.map((group) => (
              <div
                key={group.currency}
                style={{
                  background: "rgba(255, 255, 255, 0.7)",
                  padding: "8px 12px",
                  borderRadius: 8,
                  fontSize: 13,
                }}
              >
                <span style={{ fontWeight: 600, color: "#212b36" }}>
                  {formatCurrency(group.totalGMV, group.currency)}
                </span>
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
      
      {/* 错误提示 */}
      {errorCount > 0 && (
        <div
          style={{
            marginTop: 16,
            padding: "8px 12px",
            background: "#fff2f0",
            border: "1px solid #ffccc7",
            borderRadius: 6,
            fontSize: 13,
            color: "#a8071a",
          }}
        >
          ⚠️ {en 
            ? `${errorCount} store${errorCount > 1 ? "s" : ""} failed to load data`
            : `${errorCount} 个店铺数据加载失败`}
        </div>
      )}
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
          ? "Install AI SEO & Discovery on your other Shopify stores using the same account email to see aggregated data here."
          : "在您的其他 Shopify 店铺上安装 AI SEO & Discovery（使用相同的账户邮箱），即可在此查看汇总数据。"}
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

function UpgradePrompt({ en }: { en: boolean }) {
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
      <h2 style={{ 
        fontSize: 28, 
        fontWeight: 700, 
        color: "#212b36", 
        marginBottom: 12,
        margin: "0 0 12px",
      }}>
        {en ? "Multi-Store Overview" : "多店铺汇总"}
      </h2>
      <p style={{ 
        fontSize: 16, 
        color: "#637381", 
        marginBottom: 24,
        lineHeight: 1.6,
      }}>
        {en
          ? "Aggregate and compare data across all your Shopify stores in one dashboard. See combined AI attribution, GMV, and performance metrics."
          : "在一个仪表盘中汇总和对比您所有 Shopify 店铺的数据。查看合并的 AI 归因、GMV 和表现指标。"}
      </p>
      
      <div style={{
        display: "flex",
        gap: 12,
        justifyContent: "center",
        flexWrap: "wrap",
        marginBottom: 24,
      }}>
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
      
      <div style={{
        background: "#fff",
        border: "1px solid #b7eb8f",
        borderRadius: 12,
        padding: 20,
        marginBottom: 24,
      }}>
        <div style={{ fontSize: 13, color: "#389e0d", fontWeight: 600, marginBottom: 8 }}>
          ✨ {en ? "Growth Plan Feature" : "Growth 版专属功能"}
        </div>
        <div style={{ fontSize: 14, color: "#637381" }}>
          {en
            ? "Upgrade to Growth to unlock multi-store management and more advanced features."
            : "升级到 Growth 版解锁多店铺管理和更多高级功能。"}
        </div>
      </div>
      
      <Link
        to="/app/billing"
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
        {en ? "Upgrade to Growth →" : "升级到 Growth →"}
      </Link>
    </div>
  );
}

export default function MultiStore() {
  const { language, shopDomain, isGrowth, data } = useLoaderData<typeof loader>();
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

  // 如果不是 Growth 用户，显示升级提示
  if (!isGrowth) {
    return (
      <s-page heading={en ? "Multi-Store Overview" : "多店铺汇总"}>
        <div className={styles.page}>
          {/* 顶部导航 */}
          <div style={{ marginBottom: 16, display: "flex", gap: 12 }}>
            <Link to="/app/analytics" className={styles.secondaryButton}>
              ← {en ? "Back to Analytics" : "返回分析"}
            </Link>
          </div>
          
          <UpgradePrompt en={en} />
        </div>
      </s-page>
    );
  }

  return (
    <s-page heading={en ? "Multi-Store Overview" : "多店铺汇总"}>
      <div className={styles.page}>
        {/* 顶部导航 */}
        <div style={{ marginBottom: 16, display: "flex", gap: 12 }}>
          <Link to="/app/analytics" className={styles.secondaryButton}>
            ← {en ? "Back to Analytics" : "返回分析"}
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
          totalsByCurrency={data.totalsByCurrency}
          aggregateOrders={data.aggregateOrders}
          storeCount={data.storeCount}
          errorCount={data.errorCount}
          en={en}
          formatCurrency={formatCurrency}
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
              {data.linkedStores.length} {en ? (data.linkedStores.length === 1 ? "store" : "stores") : "个店铺"}
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

