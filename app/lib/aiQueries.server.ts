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
  const localizeNote = (note: string | null): string | null => {
    if (!note || language !== "English") return note;
    let out = note;
    out = out.replace("AI 渠道订单量当前较低（<5），所有指标仅供参考。", "AI-channel order volume currently low (<5); metrics for reference only.");
    out = out.replace(/已过滤\s+(\d+)\s+笔非\s+([A-Z]{3})\s+货币的订单，汇总仅包含\s+\2。/g, "Filtered $1 orders not in $2; aggregation only includes $2.");
    out = out.replace(/已排除\s+(\d+)\s+笔\s+POS\/草稿订单（不计入站外 AI 链路分析）。/g, "Excluded $1 POS/draft orders (not counted in offsite AI flow analysis).");
    return out;
  };
  return { data: { ...data, sampleNote: clamped ? clampedNote : localizeNote(data.sampleNote) }, orders };
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
