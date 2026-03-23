import { useMemo } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData, useLocation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { Banner, StatusBadge } from "../components/ui";
import { AddStorePrompt, MultiStoreUpgradePrompt, StoreCard, TotalsSummary } from "../components/multi-store/MultiStorePanels";
import { authenticate } from "../shopify.server";
import { getSettings } from "../lib/settings.server";
import { useUILanguage } from "../lib/useUILanguage";
import styles from "../styles/app.dashboard.module.css";
import { hasFeature, FEATURES } from "../lib/access.server";
import { ordersRepository } from "../lib/repositories/orders.repository";
import { resolveDateRange } from "../lib/aiData";
import { logger } from "../lib/logger.server";
import prisma from "../db.server";
import { buildEmbeddedAppPath } from "../lib/navigation";
import type { DateRange } from "../lib/aiTypes";
import { resolveUILanguageFromRequest } from "../lib/language.server";

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

interface MultiStoreData {
  stores: StoreSnapshot[];
  totalsByCurrency: CurrencyTotals[];
  aggregateOrders: {
    totalOrders: number;
    aiOrders: number;
  };
  linkedStores: string[];
  storeCount: number;
  errorCount: number;
}

async function fetchStoreData(shop: string, range: DateRange): Promise<StoreSnapshot> {
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
  const isGrowth = await hasFeature(shopDomain, FEATURES.MULTI_STORE);
  const settings = await getSettings(shopDomain);
  const language = resolveUILanguageFromRequest(request, settings.languages?.[0] || "中文");

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

  let linkedShops: string[] = [shopDomain];

  try {
    const currentSession = await prisma.session.findFirst({
      where: { shop: shopDomain },
      select: { email: true, userId: true },
    });

    if (currentSession?.email) {
      const linkedSessions = await prisma.session.findMany({
        where: {
          email: currentSession.email,
          NOT: { shop: shopDomain },
        },
        select: { shop: true },
        distinct: ["shop"],
      });

      linkedShops = [shopDomain, ...linkedSessions.map((item) => item.shop)];
    }
  } catch (error) {
    logger.warn("[multi-store] Failed to find linked shops", { shopDomain }, { error });
  }

  const range = resolveDateRange("30d");
  const storeResults = await Promise.allSettled(linkedShops.map((shop) => fetchStoreData(shop, range)));

  const storeSnapshots: StoreSnapshot[] = storeResults.map((result, index) => {
    const shop = linkedShops[index];
    if (result.status === "fulfilled") return result.value;

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
  });

  const errorCount = storeSnapshots.filter((store) => store.loadError).length;
  const currencyMap = new Map<string, CurrencyTotals>();

  for (const store of storeSnapshots) {
    if (store.loadError) continue;
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

  const totalsByCurrency = Array.from(currencyMap.values())
    .map((group) => ({
      ...group,
      aiShare: group.totalGMV > 0 ? (group.aiGMV / group.totalGMV) * 100 : 0,
    }))
    .sort((a, b) => b.totalGMV - a.totalGMV);

  const aggregateOrders = {
    totalOrders: storeSnapshots.filter((store) => !store.loadError).reduce((sum, store) => sum + store.totalOrders, 0),
    aiOrders: storeSnapshots.filter((store) => !store.loadError).reduce((sum, store) => sum + store.aiOrders, 0),
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
      storeCount: storeSnapshots.filter((store) => !store.loadError).length,
      errorCount,
    } as MultiStoreData,
  };
};

export default function MultiStore() {
  const { language, shopDomain, isGrowth, data } = useLoaderData<typeof loader>();
  const uiLanguage = useUILanguage(language);
  const en = uiLanguage === "English";
  const location = useLocation();
  const dashboardHref = buildEmbeddedAppPath("/app", location.search, { backTo: null, fromTab: null, tab: null });

  const formatCurrency = useMemo(() => {
    return (amount: number, currency = "USD") =>
      new Intl.NumberFormat(en ? "en-US" : "zh-CN", {
        style: "currency",
        currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(amount);
  }, [en]);

  if (!isGrowth) {
    return (
      <s-page heading={en ? "Multi-Store Overview" : "多店铺汇总"}>
        <div className={styles.page}>
          <div style={{ marginBottom: 16, display: "flex", gap: 12 }}>
            <Link to={dashboardHref} className={styles.secondaryButton}>
              ← {en ? "Back to Dashboard" : "返回仪表盘"}
            </Link>
          </div>
          <MultiStoreUpgradePrompt en={en} />
        </div>
      </s-page>
    );
  }

  return (
    <s-page heading={en ? "Multi-Store Overview" : "多店铺汇总"}>
      <div className={styles.page}>
        <div style={{ marginBottom: 16, display: "flex", gap: 12 }}>
          <Link to={dashboardHref} className={styles.secondaryButton}>
            ← {en ? "Back to Dashboard" : "返回仪表盘"}
          </Link>
        </div>

        <StatusBadge tone="success" style={{ marginBottom: 20 }}>
          ✨ {en ? "Requires Growth" : "需要 Growth 版"}
        </StatusBadge>

        <TotalsSummary
          totalsByCurrency={data.totalsByCurrency}
          aggregateOrders={data.aggregateOrders}
          storeCount={data.storeCount}
          errorCount={data.errorCount}
          en={en}
          formatCurrency={formatCurrency}
        />

        <div className={styles.card}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.sectionLabel}>{en ? "Connected Stores" : "已连接店铺"}</p>
              <h3 className={styles.sectionTitle}>{en ? "Store Performance Comparison" : "店铺表现对比"}</h3>
            </div>
            <span className={styles.badge}>
              {data.storeCount} {en ? (data.storeCount === 1 ? "store" : "stores") : "个店铺"}
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
            <AddStorePrompt en={en} />
          </div>
        </div>

        <Banner status="warning">
          <strong>💡 {en ? "How it works:" : "工作原理："}</strong>{" "}
          {en
            ? "Stores are automatically linked when you install the app using the same Shopify account email. Data is aggregated from all linked stores for the last 30 days."
            : "当您使用相同的 Shopify 账户邮箱安装应用时，店铺会自动关联。数据汇总自所有关联店铺的最近 30 天。"}
        </Banner>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
