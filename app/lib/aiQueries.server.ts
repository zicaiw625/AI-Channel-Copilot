import type {
  ComparisonRow,
  DashboardData,
  DateRange,
  OrderRecord,
  ProductRow,
  SettingsDefaults,
  RawOrderRow,
} from "./aiData";
import { buildDashboardData, buildDashboardFromOrders } from "./aiData";
import { loadOrdersFromDb, loadCustomersByIds } from "./persistence.server";
import { allowDemoData } from "./runtime.server";

type DashboardQueryOptions = {
  timezone?: string;
  allowDemo?: boolean;
  orders?: OrderRecord[];
};

export const getAiDashboardData = async (
  shopDomain: string,
  range: DateRange,
  settings: SettingsDefaults,
  options: DashboardQueryOptions = {},
): Promise<{ data: DashboardData; orders: OrderRecord[] }> => {
  const useDemo = options.allowDemo ?? allowDemoData();
  const { orders, clamped } = options.orders
    ? { orders: options.orders, clamped: false }
    : shopDomain
      ? await loadOrdersFromDb(shopDomain, range)
      : { orders: [], clamped: false };

  let acquiredMap: Record<string, boolean> | undefined = undefined;
  if (orders.length) {
    const ids = Array.from(new Set(orders.map((o) => o.customerId).filter(Boolean) as string[]));
    if (ids.length) {
      const customers = await loadCustomersByIds(shopDomain, ids);
      acquiredMap = customers.reduce<Record<string, boolean>>((acc, c) => {
        acc[c.id] = Boolean(c.acquiredViaAi);
        return acc;
      }, {});
    }
  }

  const data = orders.length
    ? buildDashboardFromOrders(
        orders,
        range,
        settings.gmvMetric,
        options.timezone,
        settings.primaryCurrency,
        acquiredMap,
      )
    : useDemo
      ? buildDashboardData(range, settings.gmvMetric, options.timezone, settings.primaryCurrency)
      : buildDashboardFromOrders(
          [],
          range,
          settings.gmvMetric,
          options.timezone,
          settings.primaryCurrency,
          undefined,
        );

  const language = settings.languages && settings.languages[0] ? settings.languages[0] : "中文";
  const clampedNote = language === "English" ? "Data is a truncated sample; consider shortening the time range." : "数据为截断样本，建议缩短时间范围";
  return { data: { ...data, sampleNote: clamped ? clampedNote : data.sampleNote }, orders };
};

export const getAiOverview = async (
  shopDomain: string,
  range: DateRange,
  settings: SettingsDefaults,
  options?: DashboardQueryOptions,
) => {
  const { data } = await getAiDashboardData(shopDomain, range, settings, options);
  return data.overview;
};

export const getAiChannelComparison = async (
  shopDomain: string,
  range: DateRange,
  settings: SettingsDefaults,
  options?: DashboardQueryOptions,
): Promise<ComparisonRow[]> => {
  const { data } = await getAiDashboardData(shopDomain, range, settings, options);
  return data.comparison;
};

export const getAiTopProducts = async (
  shopDomain: string,
  range: DateRange,
  settings: SettingsDefaults,
  options?: DashboardQueryOptions,
): Promise<ProductRow[]> => {
  const { data } = await getAiDashboardData(shopDomain, range, settings, options);
  return data.topProducts;
};

export const getAiRecentOrders = async (
  shopDomain: string,
  range: DateRange,
  settings: SettingsDefaults,
  options?: DashboardQueryOptions,
): Promise<RawOrderRow[]> => {
  const { data } = await getAiDashboardData(shopDomain, range, settings, options);
  return data.recentOrders;
};
