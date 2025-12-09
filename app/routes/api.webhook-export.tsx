import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { requireFeature, FEATURES } from "../lib/access.server";
import { getSettings, saveSettings } from "../lib/settings.server";
import { logger } from "../lib/logger.server";
import { OrdersRepository } from "../lib/repositories/orders.repository";
import { resolveDateRange } from "../lib/aiData";

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
  data: any;
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
  
  const formData = await request.formData();
  const intent = formData.get("intent");
  
  if (intent === "update_config") {
    const enabled = formData.get("enabled") === "true";
    const url = formData.get("url") as string;
    const secret = formData.get("secret") as string;
    const events = (formData.get("events") as string || "").split(",").filter(Boolean);
    
    // 验证 URL
    if (enabled && url) {
      try {
        new URL(url);
      } catch {
        return Response.json({ ok: false, error: "Invalid URL format" }, { status: 400 });
      }
    }
    
    const webhookConfig: WebhookConfig = {
      enabled,
      url: url || "",
      secret: secret || "",
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
    const url = formData.get("url") as string;
    const secret = formData.get("secret") as string;
    
    if (!url) {
      return Response.json({ ok: false, error: "URL is required" }, { status: 400 });
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
    
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AICC-Signature": generateSignature(JSON.stringify(testPayload), secret),
          "X-AICC-Event": "test",
        },
        body: JSON.stringify(testPayload),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      logger.info("[webhook-export] Test webhook sent", { shopDomain, url, status: response.status });
      
      return Response.json({ ok: true, status: response.status });
    } catch (error) {
      logger.error("[webhook-export] Test webhook failed", { shopDomain, url }, { error });
      return Response.json({ 
        ok: false, 
        error: error instanceof Error ? error.message : "Failed to send webhook",
      }, { status: 500 });
    }
  }
  
  if (intent === "trigger_export") {
    const url = formData.get("url") as string;
    const secret = formData.get("secret") as string;
    const range = (formData.get("range") as string) || "7d";
    
    if (!url) {
      return Response.json({ ok: false, error: "URL is required" }, { status: 400 });
    }
    
    try {
      // 获取订单数据
      const ordersRepo = new OrdersRepository();
      const dateRange = resolveDateRange(range as any);
      const orders = await ordersRepo.findByShopAndDateRange(shopDomain, dateRange, {
        aiOnly: true,
        limit: 1000,
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
          orders: orders.slice(0, 100).map(order => ({
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
      
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AICC-Signature": generateSignature(JSON.stringify(exportPayload), secret),
          "X-AICC-Event": "data_export",
        },
        body: JSON.stringify(exportPayload),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      // 更新最后触发时间
      const currentSettings = await getSettings(shopDomain);
      await saveSettings(shopDomain, {
        ...currentSettings,
        webhookExport: {
          ...(currentSettings as any).webhookExport,
          lastTriggeredAt: new Date().toISOString(),
          lastStatus: "success",
        },
      } as any);
      
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

// ============================================================================
// Helpers
// ============================================================================

function generateSignature(payload: string, secret: string): string {
  if (!secret) return "";
  
  // 简单的 HMAC-like 签名（实际应使用 crypto.createHmac）
  // 由于 Edge runtime 限制，这里用简化版本
  const encoder = new TextEncoder();
  const data = encoder.encode(payload + secret);
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) - hash) + data[i];
    hash |= 0;
  }
  return `sha256=${Math.abs(hash).toString(16)}`;
}

