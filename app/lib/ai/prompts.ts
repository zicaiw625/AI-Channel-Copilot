import type { CopilotIntent } from "../copilot.intent";
import type { DashboardData } from "../aiData";
import { formatCurrency, formatPercentage } from "../formatting";

type OverviewShape = {
  aiOrders: number;
  totalOrders: number;
  aiGmvFmt: string;
  totalGmvFmt: string;
  netAiGmvFmt: string;
  netGmvFmt: string;
  aiShareFmt: string;
  aiAovFmt: string;
  allAovFmt: string;
  aiNewRateFmt: string;
  topProducts: string[];
};

export const buildOverviewShape = (
  data: DashboardData,
  language: string = "中文"
): OverviewShape => {
  const aiAov = data.overview.aiOrders ? data.overview.aiGMV / data.overview.aiOrders : 0;
  const allAov = data.overview.totalOrders ? data.overview.totalGMV / data.overview.totalOrders : 0;

  const topProducts = (data.topProducts || [])
    .slice(0, 5)
    .map((p) => {
      const gmvText = formatCurrency(p.aiGMV, data.overview.currency, language);
      return language === "English"
        ? `${p.title} (AI GMV ${gmvText})`
        : `${p.title}（AI GMV ${gmvText}）`;
    });

  return {
    aiOrders: data.overview.aiOrders,
    totalOrders: data.overview.totalOrders,
    aiGmvFmt: formatCurrency(data.overview.aiGMV, data.overview.currency, language),
    totalGmvFmt: formatCurrency(data.overview.totalGMV, data.overview.currency, language),
    netAiGmvFmt: formatCurrency(data.overview.netAiGMV, data.overview.currency, language),
    netGmvFmt: formatCurrency(data.overview.netGMV, data.overview.currency, language),
    aiShareFmt: formatPercentage(data.overview.aiShare),
    aiAovFmt: formatCurrency(aiAov, data.overview.currency, language),
    allAovFmt: formatCurrency(allAov, data.overview.currency, language),
    aiNewRateFmt: formatPercentage(data.overview.aiNewCustomerRate),
    topProducts,
  };
};

export const INTENT_TEMPLATES: Record<CopilotIntent, (ctx: {
  rangeLabel: string;
  metric: string;
  overview: OverviewShape;
}) => string> = {
  ai_performance: ({ rangeLabel, metric, overview }) =>
    `基于你过去 ${rangeLabel} 的数据，AI 渠道订单 ${overview.aiOrders}，AI GMV ${overview.aiGmvFmt}（占比 ${overview.aiShareFmt}，净 ${overview.netAiGmvFmt}）。总 GMV ${overview.totalGmvFmt}（净 ${overview.netGmvFmt}），总订单 ${overview.totalOrders}。指标口径：GMV=${metric}；仅统计可识别的 AI 流量。`,
  ai_vs_all_aov: ({ rangeLabel, metric, overview }) =>
    `基于你过去 ${rangeLabel} 的数据，AI 渠道 AOV 约 ${overview.aiAovFmt}，全站 AOV 约 ${overview.allAovFmt}。AI 新客占比 ${overview.aiNewRateFmt}。指标口径：GMV=${metric}；仅统计可识别的 AI 流量。`,
  ai_top_products: ({ rangeLabel, metric, overview }) =>
    `基于你过去 ${rangeLabel} 的数据，AI 渠道 Top 产品：${overview.topProducts.join("；")}。建议：为这些产品补充 FAQ、在站内增加指引，并为 AI 渠道配置更明确的 UTM。指标口径：GMV=${metric}；仅统计可识别的 AI 流量。`,
};

