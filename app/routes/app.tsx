import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { useUILanguage } from "../lib/useUILanguage";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { NavMenu } from "@shopify/app-bridge-react";

import { authenticate, unauthenticated } from "../shopify.server";
import { readAppFlags, requireEnv } from "../lib/env.server";
import { getSettings, syncShopPreferences } from "../lib/settings.server";
import { logger } from "../lib/logger.server";
import { detectAndPersistDevShop, shouldSkipBillingForPath, calculateRemainingTrialDays } from "../lib/billing.server";
import { getEffectivePlan, FEATURES, hasFeature, type PlanTier } from "../lib/access.server";
import { startBackfill, processBackfillQueue } from "../lib/backfill.server";
import { resolveDateRange } from "../lib/aiData";
import { BACKFILL_COOLDOWN_MINUTES, MAX_BACKFILL_DURATION_MS, MAX_BACKFILL_ORDERS } from "../lib/constants";
import { ensureWebhooks } from "../lib/webhooks.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { demoMode, enableBilling } = readAppFlags();
  const demo = demoMode;
  type AuthShape = Awaited<ReturnType<typeof authenticate.admin>>;
  let admin: AuthShape["admin"] | null = null;
  let session: AuthShape["session"] | null = null;
  let authFailed = false;

  try {
    const auth = await authenticate.admin(request);
    admin = auth.admin;
    session = auth.session;
  } catch (e) {
    authFailed = true;
    const url = new URL(request.url);
    const path = url.pathname.toLowerCase();
    const allowUnauth = path.includes("/app/onboarding") || path.includes("/app/billing") || path.includes("/app/redirect");
    if (!demo && !allowUnauth) throw e;
  }

  const shopDomain = session?.shop || "";
  let settings = await getSettings(shopDomain);
  
  // Only use admin client if authentication was successful
  if (admin && shopDomain && !authFailed) {
    try {
      settings = await syncShopPreferences(admin, shopDomain, settings);
    } catch (e) {
      // If syncShopPreferences fails, log but continue with default settings
      logger.warn("[app] syncShopPreferences failed", { shopDomain }, { error: (e as Error).message });
    }
    
    // 确保 webhooks 已注册（每次都检查，SDK 会自动处理幂等性）
    try {
      await ensureWebhooks(session as Parameters<typeof ensureWebhooks>[0]);
    } catch (e) {
      logger.warn("[app] ensureWebhooks failed", { shopDomain }, { error: (e as Error).message });
    }
    
    // 首次安装时自动触发 backfill（检查 lastBackfillAt 为空）
    const now = new Date();
    const lastBackfillAt = settings.lastBackfillAt ? new Date(settings.lastBackfillAt) : null;
    const withinCooldown = lastBackfillAt && now.getTime() - lastBackfillAt.getTime() < BACKFILL_COOLDOWN_MINUTES * 60 * 1000;
    
    if (!withinCooldown && !lastBackfillAt) {
      logger.info("[app] First install detected, triggering initial backfill", { shopDomain });
      const calculationTimezone = settings.timezones[0] || "UTC";
      const range = resolveDateRange("90d", new Date(), undefined, undefined, calculationTimezone);
      
      try {
        const queued = await startBackfill(shopDomain, range, {
          maxOrders: MAX_BACKFILL_ORDERS,
          maxDurationMs: MAX_BACKFILL_DURATION_MS,
        });
        
        if (queued.queued) {
          logger.info("[app] Initial backfill queued successfully", { shopDomain, range: range.label });
          // 异步处理 backfill，不阻塞请求
          void processBackfillQueue(
            async () => {
              let resolvedAdmin: { graphql: (query: string, options: { variables?: Record<string, unknown> }) => Promise<Response> } | null = null;
              try {
                const unauthResult = await unauthenticated.admin(shopDomain);
                if (unauthResult && typeof (unauthResult as any).graphql === "function") {
                  resolvedAdmin = unauthResult as any;
                } else if (unauthResult && typeof (unauthResult as any).admin?.graphql === "function") {
                  resolvedAdmin = (unauthResult as any).admin;
                }
              } catch (err) {
                logger.warn("[app] unauthenticated.admin failed for backfill", { shopDomain, error: (err as Error).message });
              }
              return { admin: resolvedAdmin, settings };
            },
            { shopDomain },
          );
        }
      } catch (e) {
        logger.warn("[app] Failed to trigger initial backfill", { shopDomain }, { error: (e as Error).message });
      }
    }
  }

  try {
    const url = new URL(request.url);
    // Only call detectAndPersistDevShop if authentication was successful
    const isDevShop = (admin && shopDomain && !authFailed) 
      ? await detectAndPersistDevShop(admin, shopDomain) 
      : false;
    const skipBilling = shouldSkipBillingForPath(url.pathname, isDevShop);
    const billingEnabled = enableBilling;

    let plan: PlanTier = "none";
    let trialDaysLeft: number | null = null;
    let canViewFullDashboard = false;

    if (!billingEnabled || demo || isDevShop) {
        plan = "pro"; // Treat as Pro for dev/demo
        canViewFullDashboard = true;
    } else if (!skipBilling) {
        plan = await getEffectivePlan(shopDomain);
        canViewFullDashboard = await hasFeature(shopDomain, FEATURES.DASHBOARD_FULL);
        trialDaysLeft = await calculateRemainingTrialDays(shopDomain);

        const path = url.pathname.toLowerCase();
        const isProtected =
            path === "/app" ||
            (path.startsWith("/app/") &&
                !path.includes("/app/onboarding") &&
                !path.includes("/app/billing") &&
                !path.includes("/app/additional") &&
                !path.includes("/app/redirect"));

        if (isProtected && plan === "none") {
            const next = new URL("/app/onboarding", url.origin);
            next.search = url.search;
            throw new Response(null, { status: 302, headers: { Location: next.toString() } });
        }
    }

    return {
      apiKey: requireEnv("SHOPIFY_API_KEY"),
      language: settings.languages[0] || "中文",
      plan,
      trialDaysLeft,
      isDevShop,
      canViewFullDashboard
    };
  } catch (e) {
    if (e instanceof Response) throw e;
    logger.error("[app] loader error", { shopDomain }, { error: e });
    return {
      apiKey: requireEnv("SHOPIFY_API_KEY"),
      language: settings.languages[0] || "中文",
      plan: "none" as PlanTier,
      trialDaysLeft: null,
      isDevShop: false,
      canViewFullDashboard: false
    };
  }
};

export default function App() {
  const { apiKey, language, plan, trialDaysLeft, isDevShop } = useLoaderData<typeof loader>();
  const uiLanguage = useUILanguage(language);

  return (
    <AppProvider embedded apiKey={apiKey}>
      <NavMenu>
        <a href="/app" rel="home">{uiLanguage === "English" ? "AI Dashboard" : "AI 仪表盘"}</a>
        <a href="/app/additional">{uiLanguage === "English" ? "Settings / Rules & Export" : "设置 / 规则 & 导出"}</a>
        <a href="/app/billing">{uiLanguage === "English" ? "Subscription" : "订阅管理"}</a>
      </NavMenu>

      <div style={{ padding: '10px 16px', background: '#f1f2f3', borderBottom: '1px solid #dfe3e8', display: 'flex', alignItems: 'center', gap: '12px', fontSize: '13px' }}>
        {plan === "free" && (
          <span style={{ color: "#666", background: '#e4e5e7', padding: '2px 8px', borderRadius: '4px' }}>
             {uiLanguage === "English" ? "Free Plan" : "免费版"}
          </span>
        )}
        
        {(plan === "pro" || plan === "growth") && trialDaysLeft !== null && trialDaysLeft > 0 && (
          <span style={{ 
            color: plan === "growth" ? "#389e0d" : "#5c6ac4",
            fontWeight: 500,
            background: plan === "growth" ? "#f6ffed" : "#f4f5fa",
            padding: '2px 8px',
            borderRadius: '4px',
            border: `1px solid ${plan === "growth" ? "#b7eb8f" : "#e1e3e5"}`
          }}>
            {uiLanguage === "English" 
              ? `✨ Enjoying ${plan === "growth" ? "Growth" : "Pro"} · ${trialDaysLeft} day${trialDaysLeft === 1 ? '' : 's'} trial left` 
              : `✨ 正在体验 ${plan === "growth" ? "Growth" : "Pro"} · 试用剩余 ${trialDaysLeft} 天`}
          </span>
        )}
        
        {isDevShop && (
          <span style={{ color: "#555" }}>
            {uiLanguage === "English" ? "Development store" : "开发店环境"}
          </span>
        )}
      </div>
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
