import { resolveDateRange, type TimeRangeKey } from "./aiData";
import { getAiDashboardData } from "./aiQueries.server";
import { getSettings } from "./settings.server";
import { authenticate } from "../shopify.server";
import { parseIntent, type CopilotIntent } from "./copilot.intent";
import { ValidationError, AppError, ErrorCode } from "./errors";
import { logger } from "./logger.server";
import { INTENT_TEMPLATES, buildOverviewShape } from "./ai/prompts";
import { isDemoMode } from "./runtime.server";

type CopilotRequest = {
  intent?: CopilotIntent;
  question?: string;
  range?: TimeRangeKey;
  from?: string | null;
  to?: string | null;
};

export const copilotAnswer = async (request: Request, payload: CopilotRequest) => {
  // 在函数开始时声明缓存变量，供错误处理使用
  let cachedLanguage = "中文";
  let shopDomain = "";
  
  try {
    // 验证输入
    if (!payload.question && !payload.intent) {
      throw new ValidationError("Either question or intent must be provided");
    }

    let session: { shop: string } | null = null;
    
    try {
      const auth = await authenticate.admin(request);
      session = auth.session;
    } catch (error) {
      // 在非 demo 模式下，认证失败应该抛出错误
      if (!isDemoMode()) {
        throw error instanceof Error ? error : new Error(String(error));
      }
      // Demo 模式下，继续处理但没有 session
    }

    // 验证 session 存在（非 demo 模式）
    if (!isDemoMode() && (!session || !session.shop)) {
      throw new ValidationError("Invalid session: missing shop domain");
    }

    shopDomain = session?.shop || "";
    const settings = await getSettings(shopDomain);
    
    // 缓存语言设置，供错误处理使用
    cachedLanguage = settings.languages?.[0] || "中文";

    // 验证和解析时间范围
    const rangeKey: TimeRangeKey = (payload.range as TimeRangeKey) || "30d";
    if (!["7d", "30d", "90d", "custom"].includes(rangeKey)) {
      throw new ValidationError(`Invalid time range: ${rangeKey}`);
    }

    const timezone = settings.timezones?.[0] || "UTC";
    const dateRange = resolveDateRange(rangeKey, new Date(), payload.from, payload.to, timezone);

    // 如果是 Demo 模式且无 shop，允许使用 demo 数据
    const allowDemo = isDemoMode() && !shopDomain;

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
      
      // 提供更友好的错误提示，附带建议的问法
      const suggestions = language === "English"
        ? [
            '"How is AI channel performing?"',
            '"Compare AI vs overall AOV"',
            '"Top products from AI channels"',
          ]
        : [
            '"AI 渠道表现如何？"',
            '"AI 渠道 vs 全部渠道 AOV 对比"',
            '"AI 渠道热销产品有哪些？"',
          ];
      
      const message = language === "English"
        ? `Unable to recognize your question. Try asking:\n• ${suggestions.join("\n• ")}\n\nOr use the preset buttons above.`
        : `无法识别您的问题。试试这样问：\n• ${suggestions.join("\n• ")}\n\n或使用上方的快捷按钮。`;

      return {
        ok: false,
        message,
        range: dateRange.label,
        suggestions, // 返回建议列表，前端可以展示为可点击项
      };
    }

    const language = settings.languages?.[0] || "中文";
    const overviewShape = buildOverviewShape(data, language);
    const answer = INTENT_TEMPLATES[intent]({
      rangeLabel: dateRange.label,
      metric: settings.gmvMetric,
      overview: overviewShape,
      language,
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
      shopDomain,
      error: appError.message,
      code: appError.code,
      payload: {
        intent: payload.intent,
        range: payload.range,
        hasQuestion: !!payload.question,
      }
    });

    // 使用已缓存的语言设置，无需再次调用 authenticate
    const userMessage = cachedLanguage === "English"
      ? "Sorry, an error occurred while processing your request. Please try again later."
      : "抱歉，处理您的请求时出现错误，请稍后重试。";

    return {
      ok: false,
      message: userMessage,
      error: appError.code,
    };
  }
};
