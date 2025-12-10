import type { ActionFunctionArgs } from "react-router";
import type { TimeRangeKey } from "../lib/aiData";
import type { CopilotIntent } from "../lib/copilot.intent";
import { copilotAnswer } from "../lib/copilot.server";
import { authenticate } from "../shopify.server";
import { requireFeature, FEATURES } from "../lib/access.server";
import { enforceRateLimit, RateLimitRules } from "../lib/security/rateLimit.server";

// 请求体大小限制（10KB）
const MAX_REQUEST_BODY_SIZE = 10 * 1024;

// ISO 日期格式验证（YYYY-MM-DD 或 ISO 8601）
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[+-]\d{2}:\d{2})?)?$/;

/**
 * 验证日期参数格式
 * @returns 有效的日期字符串或 null
 */
const validateDateParam = (value: unknown): string | null => {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  
  // 检查格式是否匹配
  if (!ISO_DATE_REGEX.test(trimmed)) return null;
  
  // 验证日期是否有效（防止 2024-02-30 这种）
  const date = new Date(trimmed);
  if (isNaN(date.getTime())) return null;
  
  return trimmed;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session?.shop || "";
  
  // Rate limiting: 20 requests per minute per shop
  await enforceRateLimit(`copilot:${shopDomain}`, RateLimitRules.COPILOT);
  
  await requireFeature(shopDomain, FEATURES.COPILOT);

  if (request.method !== "POST") {
    return Response.json({ ok: false, message: "Method not allowed" }, { status: 405 });
  }

  // 检查请求体大小，防止大请求消耗过多内存
  const contentLength = parseInt(request.headers.get("content-length") || "0", 10);
  if (contentLength > MAX_REQUEST_BODY_SIZE) {
    return Response.json(
      { ok: false, message: "Request body too large (max 10KB)" }, 
      { status: 413 }
    );
  }

  const contentType = request.headers.get("content-type") || "";
  let payload: Record<string, unknown> = {};
  
  if (contentType.includes("application/json")) {
    try {
      payload = await request.json();
      // 验证解析结果是对象
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return Response.json(
          { ok: false, message: "Invalid JSON: expected an object" },
          { status: 400 }
        );
      }
    } catch (error) {
      // 不再静默失败，返回明确的错误响应
      return Response.json(
        { ok: false, message: "Invalid JSON body: failed to parse request" },
        { status: 400 }
      );
    }
  } else if (contentType.includes("multipart/form-data") || contentType.includes("application/x-www-form-urlencoded")) {
    try {
      const form = await request.formData();
      payload = Object.fromEntries(Array.from(form.entries()));
    } catch (error) {
      return Response.json(
        { ok: false, message: "Invalid form data: failed to parse request" },
        { status: 400 }
      );
    }
  } else {
    // 不支持的 Content-Type
    return Response.json(
      { ok: false, message: "Unsupported Content-Type. Use application/json or form data." },
      { status: 415 }
    );
  }

  const allowedIntents = new Set(["ai_performance", "ai_vs_all_aov", "ai_top_products"]);
  const allowedRanges = new Set(["7d", "30d", "90d", "custom"]);
  const intent = (payload.intent as string | undefined) || undefined;
  const range = (payload.range as string | undefined) || undefined;
  const question = (payload.question as string | undefined) || undefined;

  if (intent && !allowedIntents.has(intent)) {
    return Response.json({ ok: false, message: "invalid intent" }, { status: 400 });
  }
  if (range && !allowedRanges.has(range)) {
    return Response.json({ ok: false, message: "invalid range" }, { status: 400 });
  }
  if (question && question.length > 500) {
    return Response.json({ ok: false, message: "question too long" }, { status: 400 });
  }

  // 验证自定义日期范围参数
  const fromDate = validateDateParam(payload.from);
  const toDate = validateDateParam(payload.to);
  
  // 如果是 custom 范围，必须提供有效的 from/to
  if (range === "custom") {
    if (!fromDate || !toDate) {
      return Response.json({ 
        ok: false, 
        message: "Custom range requires valid 'from' and 'to' dates (YYYY-MM-DD format)" 
      }, { status: 400 });
    }
    // 验证 from <= to
    if (new Date(fromDate) > new Date(toDate)) {
      return Response.json({ 
        ok: false, 
        message: "'from' date must be before or equal to 'to' date" 
      }, { status: 400 });
    }
  }

  const result = await copilotAnswer(request, {
    intent: intent as CopilotIntent | undefined,
    question,
    range: range as TimeRangeKey | undefined,
    from: fromDate,
    to: toDate,
  });

  return Response.json(result);
};
