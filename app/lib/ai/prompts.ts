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
  language: string = "English"
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

type TemplateContext = {
  rangeLabel: string;
  metric: string;
  overview: OverviewShape;
  language: string;
};

// 中文模板
const INTENT_TEMPLATES_ZH: Record<CopilotIntent, (ctx: TemplateContext) => string> = {
  ai_performance: ({ rangeLabel, metric, overview }) =>
    `基于你过去 ${rangeLabel} 的数据，AI 渠道订单 ${overview.aiOrders}，AI GMV ${overview.aiGmvFmt}（占比 ${overview.aiShareFmt}，净 ${overview.netAiGmvFmt}）。总 GMV ${overview.totalGmvFmt}（净 ${overview.netGmvFmt}），总订单 ${overview.totalOrders}。指标口径：GMV=${metric}；仅统计可识别的 AI 流量。`,
  ai_vs_all_aov: ({ rangeLabel, metric, overview }) =>
    `基于你过去 ${rangeLabel} 的数据，AI 渠道 AOV 约 ${overview.aiAovFmt}，全站 AOV 约 ${overview.allAovFmt}。AI 新客占比 ${overview.aiNewRateFmt}。指标口径：GMV=${metric}；仅统计可识别的 AI 流量。`,
  ai_top_products: ({ rangeLabel, metric, overview }) =>
    `基于你过去 ${rangeLabel} 的数据，AI 渠道 Top 产品：${overview.topProducts.length ? overview.topProducts.join("；") : "暂无数据"}。建议：为这些产品补充 FAQ、在站内增加指引，并为 AI 渠道配置更明确的 UTM。指标口径：GMV=${metric}；仅统计可识别的 AI 流量。`,
};

// 英文模板
const INTENT_TEMPLATES_EN: Record<CopilotIntent, (ctx: TemplateContext) => string> = {
  ai_performance: ({ rangeLabel, metric, overview }) =>
    `Based on your data from ${rangeLabel}, AI channel orders: ${overview.aiOrders}, AI GMV: ${overview.aiGmvFmt} (${overview.aiShareFmt} share, net ${overview.netAiGmvFmt}). Total GMV: ${overview.totalGmvFmt} (net ${overview.netGmvFmt}), total orders: ${overview.totalOrders}. Metric: GMV=${metric}; only counts identifiable AI traffic.`,
  ai_vs_all_aov: ({ rangeLabel, metric, overview }) =>
    `Based on your data from ${rangeLabel}, AI channel AOV: ${overview.aiAovFmt}, overall AOV: ${overview.allAovFmt}. AI new customer rate: ${overview.aiNewRateFmt}. Metric: GMV=${metric}; only counts identifiable AI traffic.`,
  ai_top_products: ({ rangeLabel, metric, overview }) =>
    `Based on your data from ${rangeLabel}, top AI channel products: ${overview.topProducts.length ? overview.topProducts.join("; ") : "No data available"}. Suggestion: Add FAQs for these products, improve on-site guidance, and configure clearer UTM parameters for AI channels. Metric: GMV=${metric}; only counts identifiable AI traffic.`,
};

// 根据语言选择模板
export const INTENT_TEMPLATES: Record<CopilotIntent, (ctx: TemplateContext) => string> = {
  ai_performance: (ctx) => 
    ctx.language === "English" 
      ? INTENT_TEMPLATES_EN.ai_performance(ctx) 
      : INTENT_TEMPLATES_ZH.ai_performance(ctx),
  ai_vs_all_aov: (ctx) => 
    ctx.language === "English" 
      ? INTENT_TEMPLATES_EN.ai_vs_all_aov(ctx) 
      : INTENT_TEMPLATES_ZH.ai_vs_all_aov(ctx),
  ai_top_products: (ctx) => 
    ctx.language === "English" 
      ? INTENT_TEMPLATES_EN.ai_top_products(ctx) 
      : INTENT_TEMPLATES_ZH.ai_top_products(ctx),
};
