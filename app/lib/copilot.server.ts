import { resolveDateRange, type TimeRangeKey } from "./aiData";
import { getAiDashboardData } from "./aiQueries.server";
import { getSettings } from "./settings.server";
import { authenticate } from "../shopify.server";
import { parseIntent, type CopilotIntent } from "./copilot.intent";
import { formatCurrency, formatPercentage } from "./formatting";
import { ValidationError, AppError, ErrorCode } from "./errors";
import { logger } from "./logger.server";

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

const buildOverviewShape = (
  data: Awaited<ReturnType<typeof getAiDashboardData>>["data"],
  language: string = "中文"
) => {
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


export const copilotAnswer = async (request: Request, payload: CopilotRequest) => {
  try {
    // 验证输入
    if (!payload.question && !payload.intent) {
      throw new ValidationError("Either question or intent must be provided");
    }

    let session;
    try {
      const auth = await authenticate.admin(request);
      session = auth.session;
    } catch (error) {
      if (process.env.DEMO_MODE === "true") {
        // Allow demo mode to proceed without session
      } else {
        throw error;
      }
    }

    if (!session?.shop && process.env.DEMO_MODE !== "true") {
      throw new ValidationError("Invalid session: missing shop domain");
    }

    const shopDomain = session?.shop || "";
    const settings = await getSettings(shopDomain);

    // 验证和解析时间范围
    const rangeKey: TimeRangeKey = (payload.range as TimeRangeKey) || "30d";
    if (!["7d", "30d", "90d", "1y"].includes(rangeKey)) {
      throw new ValidationError(`Invalid time range: ${rangeKey}`);
    }

    const timezone = settings.timezones?.[0] || "UTC";
    const dateRange = resolveDateRange(rangeKey, new Date(), payload.from, payload.to, timezone);

    // 如果是 Demo 模式且无 shop，允许使用 demo 数据
    const allowDemo = process.env.DEMO_MODE === "true" && !shopDomain;

    const { data } = await getAiDashboardData(shopDomain, dateRange, settings, {
      timezone,
      allowDemo,
    });

    const intent = payload.intent || parseIntent(payload.question);
    if (!intent) {
      logger.warn("[copilot] Unrecognized intent", {
        shopDomain,
        question: payload.question?.slice(0, 100),
      });

      const language = settings.languages?.[0] || "中文";
      const message = language === "English"
        ? "Unable to recognize question intent, please select preset questions or clearly state metrics"
        : "无法识别问题意图，请选择预设问题或明确说明指标";

      return {
        ok: false,
        message,
        range: dateRange.label,
      };
    }

    const language = settings.languages?.[0] || "中文";
    const overviewShape = buildOverviewShape(data, language);
    const answer = INTENT_TEMPLATES[intent]({
      rangeLabel: dateRange.label,
      metric: settings.gmvMetric,
      overview: overviewShape,
    });

    const footnote = language === "English"
      ? `Data range: ${dateRange.label}; Sample size: AI orders ${overviewShape.aiOrders} / Total orders ${overviewShape.totalOrders}; GMV metric=${settings.gmvMetric}; Net GMV = Gross GMV - refunds; Only counts identifiable AI traffic.`
      : `数据范围：${dateRange.label}；样本量：AI 订单 ${overviewShape.aiOrders} / 总订单 ${overviewShape.totalOrders}；指标口径：GMV=${settings.gmvMetric}；净 GMV=毛 GMV - refunds；仅统计可识别的 AI 流量。`;

    return {
      ok: true,
      intent,
      range: dateRange.label,
      metric: settings.gmvMetric,
      data: overviewShape,
      answer,
      footnote,
    };

  } catch (error) {
    const appError = error instanceof AppError ? error : new AppError(
      ErrorCode.INTERNAL_ERROR,
      "Failed to process copilot request",
      500,
      { originalError: error instanceof Error ? error.message : String(error) }
    );

    logger.error("[copilot] Error processing request", {
      error: appError.message,
      code: appError.code,
      payload: {
        intent: payload.intent,
        range: payload.range,
        hasQuestion: !!payload.question,
      }
    });

    // 返回用户友好的错误信息
    const language = "中文"; // 默认中文，可以根据请求头或其他方式确定
    const userMessage = language === "English"
      ? "Sorry, I encountered an error processing your request. Please try again."
      : "抱歉，处理您的请求时出现错误，请稍后重试。";

    return {
      ok: false,
      message: userMessage,
      error: appError.code,
    };
  }
};
