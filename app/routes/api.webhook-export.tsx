import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { requireFeature, FEATURES } from "../lib/access.server";
import { getSettings, saveSettings } from "../lib/settings.server";
import { logger } from "../lib/logger.server";
import { OrdersRepository } from "../lib/repositories/orders.repository";
import { resolveDateRange } from "../lib/aiData";
import { enforceRateLimit, RateLimitRules } from "../lib/security/rateLimit.server";

// ============================================================================
// Constants
// ============================================================================

const WEBHOOK_TIMEOUT_MS = 30_000; // 30 秒超时
const MAX_EXPORT_ORDERS = 100; // 最大导出订单数

// ============================================================================
// Types
// ============================================================================

interface WebhookConfig {
  enabled: boolean;
  url: string;
  secret: string;
  events: string[];
  lastTriggeredAt?: string;
  lastStatus?: "success" | "failed";
  lastError?: string;
}

interface WebhookPayload {
  event: string;
  timestamp: string;
  shopDomain: string;
  data: unknown;
}

// ============================================================================
// Security Helpers
// ============================================================================

/**
 * 验证 URL 是否安全（非私网地址且使用 HTTPS）
 * 防止 SSRF 攻击
 */
function validateWebhookUrl(urlString: string): { valid: boolean; error?: string } {
  try {
    const url = new URL(urlString);
    
    // 强制 HTTPS 协议
    if (url.protocol !== "https:") {
      return { valid: false, error: "Only HTTPS URLs are allowed" };
    }
    
    const hostname = url.hostname.toLowerCase();
    
    // 检查私网地址
    const privatePatterns = [
      /^localhost$/i,
      /^127\./,
      /^10\./,
      /^192\.168\./,
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
      /^0\./,
      /^169\.254\./,  // Link-local
      /^::1$/,
      /^fc00:/i,
      /^fe80:/i,
      /^fd[0-9a-f]{2}:/i,
      /\.local$/i,
      /\.internal$/i,
      /\.localhost$/i,
    ];
    
    for (const pattern of privatePatterns) {
      if (pattern.test(hostname)) {
        return { valid: false, error: "Private network URLs are not allowed" };
      }
    }
    
    // 检查 URL 长度
    if (urlString.length > 2000) {
      return { valid: false, error: "URL is too long (max 2000 characters)" };
    }
    
    return { valid: true };
  } catch {
    return { valid: false, error: "Invalid URL format" };
  }
}

/**
 * 使用 Web Crypto API 生成 HMAC-SHA256 签名
 */
async function generateSignature(payload: string, secret: string): Promise<string> {
  if (!secret) return "";
  
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(payload);
  
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, messageData);
  const hashArray = Array.from(new Uint8Array(signature));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  
  return `sha256=${hashHex}`;
}

/**
 * 发送 Webhook 请求（带超时控制）
 */
async function sendWebhook(
  url: string,
  payload: WebhookPayload,
  secret: string,
  event: string
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  
  try {
    const body = JSON.stringify(payload);
    const signature = await generateSignature(body, secret);
    
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AICC-Event": event,
        ...(signature && { "X-AICC-Signature": signature }),
      },
      body,
      signal: controller.signal,
    });
    
    if (!response.ok) {
      return { 
        ok: false, 
        status: response.status, 
        error: `HTTP ${response.status}: ${response.statusText}` 
      };
    }
    
    return { ok: true, status: response.status };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, error: "Request timed out (30s)" };
    }
    return { 
      ok: false, 
      error: error instanceof Error ? error.message : "Unknown error" 
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

// ============================================================================
// Loader - 获取 Webhook 配置
// ============================================================================

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  
  await requireFeature(shopDomain, FEATURES.MULTI_STORE); // Growth only
  
  const settings = await getSettings(shopDomain);
  
  // 从 settings 中获取 webhook 配置
  const webhookConfig: WebhookConfig = (settings as any).webhookExport || {
    enabled: false,
    url: "",
    secret: "",
    events: ["order.created", "daily_summary"],
  };
  
  return Response.json({ 
    ok: true, 
    config: webhookConfig,
  });
};

// ============================================================================
// Action - 更新配置或触发测试
// ============================================================================

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  
  await requireFeature(shopDomain, FEATURES.MULTI_STORE); // Growth only
  
  // 速率限制
  await enforceRateLimit(`webhook-export:${shopDomain}`, RateLimitRules.EXPORT);
  
  const formData = await request.formData();
  const intent = formData.get("intent");
  
  if (intent === "update_config") {
    const enabled = formData.get("enabled") === "true";
    const url = (formData.get("url") as string)?.trim() || "";
    const secret = (formData.get("secret") as string) || "";
    const events = (formData.get("events") as string || "").split(",").filter(Boolean);
    
    // 验证 URL（如果启用且有 URL）
    if (enabled && url) {
      const validation = validateWebhookUrl(url);
      if (!validation.valid) {
        return Response.json({ ok: false, error: validation.error }, { status: 400 });
      }
    }
    
    // 验证 secret 长度
    if (secret && secret.length > 256) {
      return Response.json({ ok: false, error: "Secret is too long (max 256 characters)" }, { status: 400 });
    }
    
    const webhookConfig: WebhookConfig = {
      enabled,
      url,
      secret,
      events: events.length > 0 ? events : ["order.created", "daily_summary"],
    };
    
    // 保存配置到 settings（通过合并到现有设置）
    const currentSettings = await getSettings(shopDomain);
    await saveSettings(shopDomain, {
      ...currentSettings,
      webhookExport: webhookConfig,
    } as any);
    
    logger.info("[webhook-export] Config updated", { shopDomain, enabled });
    
    return Response.json({ ok: true, config: webhookConfig });
  }
  
  if (intent === "test_webhook") {
    const url = (formData.get("url") as string)?.trim() || "";
    const secret = (formData.get("secret") as string) || "";
    
    if (!url) {
      return Response.json({ ok: false, error: "URL is required" }, { status: 400 });
    }
    
    // 验证 URL
    const validation = validateWebhookUrl(url);
    if (!validation.valid) {
      return Response.json({ ok: false, error: validation.error }, { status: 400 });
    }
    
    // 发送测试 payload
    const testPayload: WebhookPayload = {
      event: "test",
      timestamp: new Date().toISOString(),
      shopDomain,
      data: {
        message: "This is a test webhook from AI Channel Copilot",
        testId: Math.random().toString(36).substring(7),
      },
    };
    
    const result = await sendWebhook(url, testPayload, secret, "test");
    
    if (result.ok) {
      logger.info("[webhook-export] Test webhook sent", { shopDomain, url, status: result.status });
      return Response.json({ ok: true, status: result.status });
    } else {
      logger.error("[webhook-export] Test webhook failed", { shopDomain, url, error: result.error });
      return Response.json({ ok: false, error: result.error }, { status: 500 });
    }
  }
  
  if (intent === "trigger_export") {
    const url = (formData.get("url") as string)?.trim() || "";
    const secret = (formData.get("secret") as string) || "";
    const range = (formData.get("range") as string) || "7d";
    
    if (!url) {
      return Response.json({ ok: false, error: "URL is required" }, { status: 400 });
    }
    
    // 验证 URL
    const validation = validateWebhookUrl(url);
    if (!validation.valid) {
      return Response.json({ ok: false, error: validation.error }, { status: 400 });
    }
    
    try {
      // 获取订单数据
      const ordersRepo = new OrdersRepository();
      const dateRange = resolveDateRange(range as "7d" | "30d" | "90d" | "1y");
      const orders = await ordersRepo.findByShopAndDateRange(shopDomain, dateRange, {
        aiOnly: true,
        limit: MAX_EXPORT_ORDERS, // 使用常量保持一致
      });
      
      const stats = await ordersRepo.getAggregateStats(shopDomain, dateRange);
      
      const exportPayload: WebhookPayload = {
        event: "data_export",
        timestamp: new Date().toISOString(),
        shopDomain,
        data: {
          range,
          dateRange: {
            start: dateRange.start.toISOString(),
            end: dateRange.end.toISOString(),
          },
          summary: {
            totalOrders: stats.total.orders,
            totalGMV: stats.total.gmv,
            aiOrders: stats.ai.orders,
            aiGMV: stats.ai.gmv,
            aiShare: stats.total.gmv > 0 ? (stats.ai.gmv / stats.total.gmv) * 100 : 0,
          },
          orders: orders.map(order => ({
            id: order.id,
            name: order.name,
            createdAt: order.createdAt,
            totalPrice: order.totalPrice,
            currency: order.currency,
            aiSource: order.aiSource,
            referrer: order.referrer,
            utmSource: order.utmSource,
            utmMedium: order.utmMedium,
          })),
        },
      };
      
      const result = await sendWebhook(url, exportPayload, secret, "data_export");
      
      // 更新状态
      const currentSettings = await getSettings(shopDomain);
      await saveSettings(shopDomain, {
        ...currentSettings,
        webhookExport: {
          ...(currentSettings as any).webhookExport,
          lastTriggeredAt: new Date().toISOString(),
          lastStatus: result.ok ? "success" : "failed",
          ...(result.ok ? {} : { lastError: result.error }),
        },
      } as any);
      
      if (result.ok) {
        logger.info("[webhook-export] Data export sent", { 
          shopDomain, 
          url, 
          ordersCount: orders.length,
        });
        
        return Response.json({ 
          ok: true, 
          ordersExported: orders.length,
          summary: exportPayload.data.summary,
        });
      } else {
        logger.error("[webhook-export] Data export failed", { shopDomain, url, error: result.error });
        return Response.json({ ok: false, error: result.error }, { status: 500 });
      }
    } catch (error) {
      logger.error("[webhook-export] Data export failed", { shopDomain, url }, { error });
      
      // 更新失败状态
      const failedSettings = await getSettings(shopDomain);
      await saveSettings(shopDomain, {
        ...failedSettings,
        webhookExport: {
          ...(failedSettings as any).webhookExport,
          lastTriggeredAt: new Date().toISOString(),
          lastStatus: "failed",
          lastError: error instanceof Error ? error.message : "Unknown error",
        },
      } as any);
      
      return Response.json({ 
        ok: false, 
        error: error instanceof Error ? error.message : "Failed to export data",
      }, { status: 500 });
    }
  }
  
  return Response.json({ ok: false, error: "Unknown intent" }, { status: 400 });
};
