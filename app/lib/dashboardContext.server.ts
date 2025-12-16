import type { SettingsDefaults, DateRange, TimeRangeKey, OrderRecord } from "./aiData";
import { resolveDateRange } from "./aiData";
import { loadOrdersFromDb, persistOrders, removeDeletedOrders } from "./persistence.server";
import { allowDemoData } from "./runtime.server";
import { isBackfillRunning } from "./backfill.server";
import { fetchOrdersForRange } from "./shopifyOrders.server";
import { logger } from "./logger.server";
import {
  BACKFILL_COOLDOWN_MINUTES,
  DEFAULT_RANGE_KEY,
  MAX_BACKFILL_DURATION_MS,
  MAX_BACKFILL_ORDERS,
} from "./constants";

export type DashboardDataSource = "stored" | "demo" | "empty" | "live";

export type DashboardContextOptions = {
  shopDomain: string;
  admin?: { graphql: (query: string, options: { variables?: Record<string, unknown> }) => Promise<Response> } | null;
  settings: SettingsDefaults;
  url: URL;
  defaultRangeKey?: TimeRangeKey;
  includeBackfillState?: boolean;
  fallbackToShopify?: boolean;
  fallbackIntent?: string;
  backfillCooldownMinutes?: number;
};

export type DashboardContextResult = {
  dateRange: DateRange;
  dataSource: DashboardDataSource;
  orders: OrderRecord[];
  clamped: boolean;
  backfillSuppressed: boolean;
  backfillAvailable: boolean;
  displayTimezone: string;
  calculationTimezone: string;
  language: string;
  currency: string;
  dataLastUpdated: string | null;
};

export const loadDashboardContext = async ({
  shopDomain,
  admin,
  settings,
  url,
  defaultRangeKey = DEFAULT_RANGE_KEY,
  includeBackfillState = false,
  fallbackToShopify = false,
  fallbackIntent = "settings-export",
  backfillCooldownMinutes = BACKFILL_COOLDOWN_MINUTES,
}: DashboardContextOptions): Promise<DashboardContextResult> => {
  const rangeKey = (url.searchParams.get("range") as TimeRangeKey) || defaultRangeKey;
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const displayTimezone = settings.timezones[0] || "UTC";
  const language = settings.languages[0] || "中文";
  const currency = settings.primaryCurrency || "USD";
  const calculationTimezone = displayTimezone || "UTC";
  const dateRange = resolveDateRange(rangeKey, new Date(), from, to, calculationTimezone);
  const lastBackfillAt = settings.lastBackfillAt ? new Date(settings.lastBackfillAt) : null;

  let dataSource: DashboardDataSource = "live";
  const { orders: storedOrders, clamped: storedClamped } = await loadOrdersFromDb(shopDomain, dateRange);
  let orders = storedOrders;
  let clamped = storedClamped;
  let backfillSuppressed = false;
  let backfillAvailable = false;
  const demoAllowed = allowDemoData();

  if (orders.length > 0) {
    dataSource = "stored";
  } else {
    const now = new Date();
    const withinCooldown =
      lastBackfillAt &&
      now.getTime() - lastBackfillAt.getTime() < backfillCooldownMinutes * 60 * 1000;

    if (withinCooldown) {
      dataSource = "stored";
      backfillSuppressed = true;
    } else if (includeBackfillState) {
      dataSource = demoAllowed ? "demo" : "empty";
    } else {
      dataSource = demoAllowed ? "demo" : "empty";
    }
  }

  if (includeBackfillState) {
    backfillAvailable = !(await isBackfillRunning(shopDomain));
  }

  if (orders.length === 0 && fallbackToShopify && admin) {
    try {
      const fetched = await fetchOrdersForRange(
        admin,
        dateRange,
        settings,
        {
          shopDomain,
          intent: fallbackIntent,
          rangeLabel: dateRange.label,
        },
        { maxOrders: MAX_BACKFILL_ORDERS, maxDurationMs: MAX_BACKFILL_DURATION_MS },
      );

      // 【修复】处理权限相关的错误
      if (fetched.error) {
        logger.warn("[backfill] fallback fetch failed due to access restriction", { 
          shopDomain,
          errorCode: fetched.error.code,
          suggestReauth: fetched.error.suggestReauth,
        }, { message: fetched.error.message });
        dataSource = demoAllowed ? "demo" : "empty";
      } else {
        orders = fetched.orders;
        clamped = fetched.clamped;
        if (orders.length > 0) {
          await persistOrders(shopDomain, orders);
          // 【修复】删除数据库中存在但 Shopify 已删除的订单
          const shopifyOrderIds = new Set(fetched.orders.map(o => o.id));
          await removeDeletedOrders(shopDomain, dateRange, shopifyOrderIds);
          dataSource = "live";
        }
      }
    } catch (error) {
      logger.warn("[backfill] fallback fetch skipped", { shopDomain }, { message: (error as Error).message });
      dataSource = demoAllowed ? "demo" : "empty";
    }
  }

  const dataLastUpdated = (() => {
    const timestamps = [settings.lastOrdersWebhookAt, settings.lastBackfillAt].filter(Boolean);
    if (!timestamps.length) return null;
    const latest = timestamps
      .map((value) => new Date(value as string))
      .sort((a, b) => b.getTime() - a.getTime())[0];
    return latest.toISOString();
  })();

  return {
    dateRange,
    orders,
    dataSource,
    clamped,
    backfillSuppressed,
    backfillAvailable,
    displayTimezone,
    calculationTimezone,
    language,
    currency,
    dataLastUpdated,
  };
};
