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
      if (isDemoMode()) {
        // Allow demo mode to proceed without session
      } else {
        throw error;
      }
    }

    if (!session?.shop && !isDemoMode()) {
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
      error: appError.message,
      code: appError.code,
      payload: {
        intent: payload.intent,
        range: payload.range,
        hasQuestion: !!payload.question,
      }
    });

    // 返回用户友好的错误信息 (默认中文)
    const userMessage = "抱歉，处理您的请求时出现错误，请稍后重试。";

    return {
      ok: false,
      message: userMessage,
      error: appError.code,
    };
  }
};
