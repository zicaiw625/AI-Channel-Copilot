import { resolveDateRange, type TimeRangeKey } from "./aiData";
import { getAiDashboardData } from "./aiQueries.server";
import { getSettings } from "./settings.server";
import { authenticate } from "../shopify.server";

type CopilotIntent =
  | "ai_performance"
  | "ai_vs_all_aov"
  | "ai_top_products";

type CopilotRequest = {
  intent?: CopilotIntent;
  question?: string;
  range?: TimeRangeKey;
  from?: string | null;
  to?: string | null;
};

const INTENT_TEMPLATES: Record<CopilotIntent, (ctx: {
  rangeLabel: string;
  metric: string;
  overview: ReturnType<typeof buildOverviewShape>;
}) => string> = {
  ai_performance: ({ rangeLabel, metric, overview }) =>
    `基于你过去 ${rangeLabel} 的数据，AI 渠道订单 ${overview.aiOrders}，AI GMV ${overview.aiGmvFmt}（占比 ${overview.aiShareFmt}，净 ${overview.netAiGmvFmt}）。总 GMV ${overview.totalGmvFmt}（净 ${overview.netGmvFmt}），总订单 ${overview.totalOrders}。指标口径：GMV=${metric}；仅统计可识别的 AI 流量。`,
  ai_vs_all_aov: ({ rangeLabel, metric, overview }) =>
    `基于你过去 ${rangeLabel} 的数据，AI 渠道 AOV 约 ${overview.aiAovFmt}，全站 AOV 约 ${overview.allAovFmt}。AI 新客占比 ${overview.aiNewRateFmt}。指标口径：GMV=${metric}；仅统计可识别的 AI 流量。`,
  ai_top_products: ({ rangeLabel, metric, overview }) =>
    `基于你过去 ${rangeLabel} 的数据，AI 渠道 Top 产品：${overview.topProducts.join("；")}。建议：为这些产品补充 FAQ、在站内增加指引，并为 AI 渠道配置更明确的 UTM。指标口径：GMV=${metric}；仅统计可识别的 AI 流量。`,
};

const buildOverviewShape = (data: Awaited<ReturnType<typeof getAiDashboardData>>["data"]) => {
  const fmtCurrency = (value: number, currency: string) =>
    new Intl.NumberFormat("zh-CN", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);

  const aiAov = data.overview.aiOrders ? data.overview.aiGMV / data.overview.aiOrders : 0;
  const allAov = data.overview.totalOrders ? data.overview.totalGMV / data.overview.totalOrders : 0;
  const topProducts = (data.topProducts || []).slice(0, 5).map((p) => `${p.title}（AI GMV ${fmtCurrency(p.aiGMV, data.overview.currency)}）`);

  return {
    aiOrders: data.overview.aiOrders,
    totalOrders: data.overview.totalOrders,
    aiGmvFmt: fmtCurrency(data.overview.aiGMV, data.overview.currency),
    totalGmvFmt: fmtCurrency(data.overview.totalGMV, data.overview.currency),
    netAiGmvFmt: fmtCurrency(data.overview.netAiGMV, data.overview.currency),
    netGmvFmt: fmtCurrency(data.overview.netGMV, data.overview.currency),
    aiShareFmt: `${(data.overview.aiShare * 100).toFixed(1)}%`,
    aiAovFmt: fmtCurrency(aiAov, data.overview.currency),
    allAovFmt: fmtCurrency(allAov, data.overview.currency),
    aiNewRateFmt: `${(data.overview.aiNewCustomerRate * 100).toFixed(1)}%`,
    topProducts,
  };
};

const parseIntent = (raw?: string | null): CopilotIntent | undefined => {
  if (!raw) return undefined;
  const q = raw.toLowerCase();
  if (q.includes("aov") || q.includes("客单价") || q.includes("对比")) return "ai_vs_all_aov";
  if (q.includes("top") || q.includes("产品") || q.includes("销量")) return "ai_top_products";
  if (q.includes("表现") || q.includes("gmv") || q.includes("订单")) return "ai_performance";
  return undefined;
};

export const copilotAnswer = async (request: Request, payload: CopilotRequest) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session?.shop || "";
  const settings = await getSettings(shopDomain);
  const rangeKey: TimeRangeKey = (payload.range as TimeRangeKey) || "30d";
  const timezone = settings.timezones[0] || "UTC";
  const dateRange = resolveDateRange(rangeKey, new Date(), payload.from, payload.to, timezone);

  const { data } = await getAiDashboardData(shopDomain, dateRange, settings, {
    timezone,
    allowDemo: false,
  });

  const intent = payload.intent || parseIntent(payload.question);
  const overviewShape = buildOverviewShape(data);

  if (!intent) {
    return {
      ok: false,
      message: "无法识别问题意图，请选择预设问题或明确说明指标",
      range: dateRange.label,
    };
  }

  const answer = INTENT_TEMPLATES[intent]({
    rangeLabel: dateRange.label,
    metric: settings.gmvMetric,
    overview: overviewShape,
  });

  return {
    ok: true,
    intent,
    range: dateRange.label,
    metric: settings.gmvMetric,
    data: overviewShape,
    answer,
    footnote: `数据范围：${dateRange.label}；样本量：AI 订单 ${overviewShape.aiOrders} / 总订单 ${overviewShape.totalOrders}；指标口径：GMV=${settings.gmvMetric}；净 GMV=毛 GMV - refunds；仅统计可识别的 AI 流量。`,
  };
};
