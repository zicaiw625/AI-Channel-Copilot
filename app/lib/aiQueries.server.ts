import type {
  ComparisonRow,
  DashboardData,
  DateRange,
  OrderRecord,
  ProductRow,
  SettingsDefaults,
} from "./aiData";
import { buildDashboardData, buildDashboardFromOrders } from "./aiData";
import { loadOrdersFromDb } from "./persistence.server";
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
  const orders = options.orders ?? (shopDomain ? await loadOrdersFromDb(shopDomain, range) : []);

  const data = orders.length
    ? buildDashboardFromOrders(orders, range, settings.gmvMetric, options.timezone)
    : useDemo
      ? buildDashboardData(range, settings.gmvMetric, options.timezone)
      : buildDashboardFromOrders([], range, settings.gmvMetric, options.timezone);

  return { data, orders };
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
