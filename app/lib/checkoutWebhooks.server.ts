/**
 * Checkout Webhook 异步处理器
 * 将 checkout 事件入队到 webhook 队列中异步处理
 * 
 * 🔒 安全注意：
 * - 不存储原始 webhook payload（可能包含客户 PII）
 * - 只存储处理所需的最小化数据
 * - email 仅存储布尔标记 hasEmail
 */

import { authenticate } from "../shopify.server";
import { getSettings } from "./settings.server";
import { processCheckoutCreate, processCheckoutUpdate, type CheckoutPayload } from "./funnelService.server";
import { enqueueWebhookJob, registerWebhookHandler, checkWebhookDuplicate } from "./webhookQueue.server";
import { logger } from "./logger.server";
import { enforceRateLimit, RateLimitRules, buildRateLimitKey } from "./security/rateLimit.server";
import {
  webhookSuccess,
  webhookBadRequest,
  handleWebhookError,
  logWebhookReceived,
  webhookRetryableError,
} from "./webhookUtils.server";

/**
 * 🔒 脱敏后的 Checkout Payload
 * 只包含处理所需的最小化字段，不存储 PII
 */
type SanitizedCheckoutPayload = {
  id: string;
  token?: string | null;
  cart_token?: string | null;
  hasEmail: boolean;           // 🔒 替代 email，不存储实际邮箱
  customerId?: string | null;  // 只存 ID 字符串
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
  total_price: string;
  subtotal_price?: string;
  currency: string;
  landing_site?: string | null;
  referring_site?: string | null;
  line_items_count: number;    // 🔒 替代完整 line_items 数组
  note_attributes?: { name: string; value: string }[];
};

/**
 * 🔒 将原始 checkout payload 转换为脱敏版本
 * 移除所有不必要的字段，特别是 PII
 */
const sanitizeCheckoutPayload = (payload: CheckoutPayload): SanitizedCheckoutPayload => {
  return {
    id: payload.id,
    token: payload.token || null,
    cart_token: payload.cart_token || null,
    hasEmail: Boolean(payload.email),  // 🔒 只存布尔值，不存实际邮箱
    customerId: payload.customer?.id?.toString() || null,
    created_at: payload.created_at,
    updated_at: payload.updated_at,
    completed_at: payload.completed_at || null,
    total_price: payload.total_price,
    subtotal_price: payload.subtotal_price,
    currency: payload.currency,
    landing_site: payload.landing_site || null,
    referring_site: payload.referring_site || null,
    line_items_count: payload.line_items?.reduce((sum, item) => sum + (item.quantity || 0), 0) || 0,
    note_attributes: payload.note_attributes?.map(attr => ({
      name: attr.name || "",
      value: attr.value || "",
    })),
  };
};

/**
 * 🔒 将脱敏 payload 转换回 CheckoutPayload 格式供处理函数使用
 * 这样不需要修改下游的 processCheckoutCreate/Update 函数
 */
const toCheckoutPayload = (sanitized: SanitizedCheckoutPayload): CheckoutPayload => {
  return {
    id: sanitized.id,
    token: sanitized.token || undefined,
    cart_token: sanitized.cart_token || undefined,
    email: sanitized.hasEmail ? "***@***.***" : undefined,  // 占位符，processCheckout 只用 Boolean()
    customer: sanitized.customerId ? { id: parseInt(sanitized.customerId, 10) } : null,
    created_at: sanitized.created_at,
    updated_at: sanitized.updated_at,
    completed_at: sanitized.completed_at,
    total_price: sanitized.total_price,
    subtotal_price: sanitized.subtotal_price,
    currency: sanitized.currency,
    landing_site: sanitized.landing_site || undefined,
    referring_site: sanitized.referring_site || undefined,
    // 重建 line_items 数组（只需要总数量）
    line_items: sanitized.line_items_count > 0 
      ? [{ quantity: sanitized.line_items_count }] 
      : undefined,
    note_attributes: sanitized.note_attributes,
  };
};

/**
 * 处理 checkouts/create webhook
 */
export const handleCheckoutCreateWebhook = async (request: Request) => {
  let shop = "";

  try {
    const authResult = await authenticate.webhook(request);
    shop = authResult.shop;
    const { topic, payload } = authResult;

    logWebhookReceived("checkouts/create", shop, topic);

    if (!shop) {
      logger.warn("[webhook] Missing shop in checkouts/create");
      return webhookBadRequest("Missing shop");
    }

    // 应用速率限制
    try {
      await enforceRateLimit(
        buildRateLimitKey("webhook", "checkout", shop),
        RateLimitRules.WEBHOOK
      );
    } catch (rateLimitError) {
      if (rateLimitError instanceof Response && rateLimitError.status === 429) {
        // Shopify 对非 2xx 会重试；这里不返回 429，避免重试风暴
        logger.warn("[webhook] Checkout rate limit exceeded; accepting webhook and queueing", { shop });
      } else {
      throw rateLimitError;
      }
    }

    const checkoutPayload = payload as CheckoutPayload;

    if (!checkoutPayload?.id) {
      logger.warn("[webhook] Invalid checkout payload", { shop });
      return webhookBadRequest("Invalid payload");
    }

    // 获取 Shopify Webhook ID 用于去重
    const externalId = request.headers.get("X-Shopify-Webhook-Id") || 
                       request.headers.get("x-shopify-webhook-id") || 
                       null;
    const triggeredAt = request.headers.get("X-Shopify-Triggered-At") || 
                        request.headers.get("x-shopify-triggered-at") || 
                        null;
    const eventTime = triggeredAt ? new Date(triggeredAt) : null;

    // 🆕 早期去重检查：在入队前检查 X-Shopify-Webhook-Id（Shopify 最佳实践）
    if (externalId) {
      const isDuplicate = await checkWebhookDuplicate(shop, "checkouts/create", externalId);
      if (isDuplicate) {
        logger.info("[webhook] Duplicate checkout/create ignored by X-Shopify-Webhook-Id", {
          shop,
          externalId,
        });
        return webhookSuccess(); // 返回 200 告诉 Shopify 已处理
      }
    }

    // 🔒 入队异步处理（使用脱敏后的 payload，不存储 PII）
    const sanitizedPayload = sanitizeCheckoutPayload(checkoutPayload);
    
    try {
      const enqueueResult = await enqueueWebhookJob({
        shopDomain: shop,
        topic: "checkouts/create",
        intent: "checkouts/create",
        payload: {
          checkoutId: sanitizedPayload.id,
          shopDomain: shop,
          sanitizedPayload,  // 🔒 使用脱敏版本替代原始 payload
        },
        externalId,
        orderId: null, // checkout 没有 orderId
        eventTime,
        run: async (jobPayload) => {
          const jobShop = jobPayload.shopDomain as string;
          const jobSanitized = jobPayload.sanitizedPayload as SanitizedCheckoutPayload;
          
          // 转换回 CheckoutPayload 格式供下游处理
          const jobCheckoutPayload = toCheckoutPayload(jobSanitized);
          
          const settings = await getSettings(jobShop);
          await processCheckoutCreate(jobShop, jobCheckoutPayload, {
            aiDomains: settings.aiDomains,
            utmSources: settings.utmSources,
            utmMediumKeywords: settings.utmMediumKeywords,
          });
          
          logger.info("[webhook] checkout processed", {
            shop: jobShop,
            checkoutId: jobSanitized.id,
          });
        },
      });

      if (enqueueResult.status === "duplicate") {
        return webhookSuccess("Duplicate");
      }
    } catch (error) {
      logger.error("[webhook] checkout/create enqueue failed", {
        shop,
        error: error instanceof Error ? error.message : String(error),
      });
      return webhookRetryableError();
    }

    return webhookSuccess();
  } catch (error) {
    return handleWebhookError(error as Error, {
      shop,
      topic: "checkouts/create",
      webhookType: "checkouts/create",
    });
  }
};

/**
 * 处理 checkouts/update webhook
 */
export const handleCheckoutUpdateWebhook = async (request: Request) => {
  let shop = "";

  try {
    const authResult = await authenticate.webhook(request);
    shop = authResult.shop;
    const { topic, payload } = authResult;

    logWebhookReceived("checkouts/update", shop, topic);

    if (!shop) {
      logger.warn("[webhook] Missing shop in checkouts/update");
      return webhookBadRequest("Missing shop");
    }

    // 应用速率限制
    try {
      await enforceRateLimit(
        buildRateLimitKey("webhook", "checkout", shop),
        RateLimitRules.WEBHOOK
      );
    } catch (rateLimitError) {
      if (rateLimitError instanceof Response && rateLimitError.status === 429) {
        // Shopify 对非 2xx 会重试；这里不返回 429，避免重试风暴
        logger.warn("[webhook] Checkout rate limit exceeded; accepting webhook and queueing", { shop });
      } else {
      throw rateLimitError;
      }
    }

    const checkoutPayload = payload as CheckoutPayload;

    if (!checkoutPayload?.id) {
      logger.warn("[webhook] Invalid checkout payload", { shop });
      return webhookBadRequest("Invalid payload");
    }

    // 获取 Shopify Webhook ID 用于去重
    const externalId = request.headers.get("X-Shopify-Webhook-Id") || 
                       request.headers.get("x-shopify-webhook-id") || 
                       null;
    const triggeredAt = request.headers.get("X-Shopify-Triggered-At") || 
                        request.headers.get("x-shopify-triggered-at") || 
                        null;
    const eventTime = triggeredAt ? new Date(triggeredAt) : null;

    // 🆕 早期去重检查：在入队前检查 X-Shopify-Webhook-Id（Shopify 最佳实践）
    if (externalId) {
      const isDuplicate = await checkWebhookDuplicate(shop, "checkouts/update", externalId);
      if (isDuplicate) {
        logger.info("[webhook] Duplicate checkout/update ignored by X-Shopify-Webhook-Id", {
          shop,
          externalId,
        });
        return webhookSuccess(); // 返回 200 告诉 Shopify 已处理
      }
    }

    // 🔒 入队异步处理（使用脱敏后的 payload，不存储 PII）
    const sanitizedPayload = sanitizeCheckoutPayload(checkoutPayload);
    
    try {
      const enqueueResult = await enqueueWebhookJob({
        shopDomain: shop,
        topic: "checkouts/update",
        intent: "checkouts/update",
        payload: {
          checkoutId: sanitizedPayload.id,
          shopDomain: shop,
          sanitizedPayload,  // 🔒 使用脱敏版本替代原始 payload
        },
        externalId,
        orderId: null,
        eventTime,
        run: async (jobPayload) => {
          const jobShop = jobPayload.shopDomain as string;
          const jobSanitized = jobPayload.sanitizedPayload as SanitizedCheckoutPayload;
          
          // 转换回 CheckoutPayload 格式供下游处理
          const jobCheckoutPayload = toCheckoutPayload(jobSanitized);
          
          const settings = await getSettings(jobShop);
          await processCheckoutUpdate(jobShop, jobCheckoutPayload, {
            aiDomains: settings.aiDomains,
            utmSources: settings.utmSources,
            utmMediumKeywords: settings.utmMediumKeywords,
          });
          
          logger.info("[webhook] checkout update processed", {
            shop: jobShop,
            checkoutId: jobSanitized.id,
          });
        },
      });

      if (enqueueResult.status === "duplicate") {
        return webhookSuccess("Duplicate");
      }
    } catch (error) {
      logger.error("[webhook] checkout/update enqueue failed", {
        shop,
        error: error instanceof Error ? error.message : String(error),
      });
      return webhookRetryableError();
    }

    return webhookSuccess();
  } catch (error) {
    return handleWebhookError(error as Error, {
      shop,
      topic: "checkouts/update",
      webhookType: "checkouts/update",
    });
  }
};

/**
 * 🔒 从 job payload 中提取 CheckoutPayload
 * 支持新格式（sanitizedPayload）和旧格式（checkoutPayload）的兼容
 */
const extractCheckoutPayloadFromJob = (jobPayload: Record<string, unknown>): CheckoutPayload | null => {
  // 新格式：使用脱敏后的 sanitizedPayload
  if (jobPayload.sanitizedPayload) {
    return toCheckoutPayload(jobPayload.sanitizedPayload as SanitizedCheckoutPayload);
  }
  // 旧格式兼容：直接使用 checkoutPayload（处理历史遗留任务）
  if (jobPayload.checkoutPayload) {
    return jobPayload.checkoutPayload as CheckoutPayload;
  }
  return null;
};

/**
 * 注册 checkout webhook 处理器
 * 🔒 支持新旧两种 payload 格式，确保历史任务可以正常处理
 */
export const registerCheckoutWebhookHandlers = () => {
  registerWebhookHandler("checkouts/create", async (jobPayload) => {
    const jobShop = jobPayload.shopDomain as string;
    const jobCheckoutPayload = extractCheckoutPayloadFromJob(jobPayload);
    
    if (!jobShop || !jobCheckoutPayload) {
      logger.warn("[webhook] checkout handler missing data", { 
        hasShop: !!jobShop, 
        hasPayload: !!jobCheckoutPayload 
      });
      return;
    }
    
    const settings = await getSettings(jobShop);
    await processCheckoutCreate(jobShop, jobCheckoutPayload, {
      aiDomains: settings.aiDomains,
      utmSources: settings.utmSources,
      utmMediumKeywords: settings.utmMediumKeywords,
    });
  });

  registerWebhookHandler("checkouts/update", async (jobPayload) => {
    const jobShop = jobPayload.shopDomain as string;
    const jobCheckoutPayload = extractCheckoutPayloadFromJob(jobPayload);
    
    if (!jobShop || !jobCheckoutPayload) {
      logger.warn("[webhook] checkout update handler missing data", { 
        hasShop: !!jobShop, 
        hasPayload: !!jobCheckoutPayload 
      });
      return;
    }
    
    const settings = await getSettings(jobShop);
    await processCheckoutUpdate(jobShop, jobCheckoutPayload, {
      aiDomains: settings.aiDomains,
      utmSources: settings.utmSources,
      utmMediumKeywords: settings.utmMediumKeywords,
    });
  });
};
