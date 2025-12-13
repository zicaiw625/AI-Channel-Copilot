import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { useUILanguage } from "../lib/useUILanguage";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { NavMenu } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import { readAppFlags, requireEnv } from "../lib/env.server";
import { getSettings, syncShopPreferences } from "../lib/settings.server";
import { logger } from "../lib/logger.server";
import { detectAndPersistDevShop, shouldSkipBillingForPath, calculateRemainingTrialDays } from "../lib/billing.server";
import { getEffectivePlan, FEATURES, hasFeature, type PlanTier } from "../lib/access.server";
import { checkSessionScopes, buildReauthorizeUrl } from "../lib/scopeCheck.server";

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

    // 检查权限是否完整
    const scopeCheck = shopDomain ? await checkSessionScopes(shopDomain) : null;
    const hasMissingScopes = scopeCheck && !scopeCheck.hasRequiredScopes;
    const reauthorizeUrl = hasMissingScopes ? buildReauthorizeUrl(shopDomain) : null;

    return {
      apiKey: requireEnv("SHOPIFY_API_KEY"),
      language: settings.languages[0] || "中文",
      plan,
      trialDaysLeft,
      isDevShop,
      canViewFullDashboard,
      // 权限检查结果
      hasMissingScopes,
      missingScopes: scopeCheck?.missingScopes || [],
      reauthorizeUrl,
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
      canViewFullDashboard: false,
      hasMissingScopes: false,
      missingScopes: [] as string[],
      reauthorizeUrl: null,
    };
  }
};

export default function App() {
  const { apiKey, language, plan, trialDaysLeft, isDevShop, hasMissingScopes, missingScopes, reauthorizeUrl } = useLoaderData<typeof loader>();
  const uiLanguage = useUILanguage(language);

  // 处理重新授权 - 嵌入式应用需要使用 App Bridge 进行重定向
  const handleReauthorize = () => {
    if (reauthorizeUrl) {
      // 对于嵌入式应用，需要跳出 iframe 进行 OAuth 授权
      // 使用 window.top 来确保整个页面重定向
      if (window.top) {
        window.top.location.href = reauthorizeUrl;
      } else {
        window.location.href = reauthorizeUrl;
      }
    }
  };

  return (
    <AppProvider embedded apiKey={apiKey}>
      <NavMenu>
        <a href="/app" rel="home">{uiLanguage === "English" ? "AI Dashboard" : "AI 仪表盘"}</a>
        <a href="/app/additional">{uiLanguage === "English" ? "Settings / Rules & Export" : "设置 / 规则 & 导出"}</a>
        <a href="/app/billing">{uiLanguage === "English" ? "Subscription" : "订阅管理"}</a>
      </NavMenu>

      {/* 权限不足警告 - 最高优先级显示 */}
      {hasMissingScopes && (
        <div style={{
          padding: '12px 16px',
          background: '#fff1f0',
          borderBottom: '1px solid #ffa39e',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '18px' }}>⚠️</span>
            <div>
              <strong style={{ color: '#cf1322' }}>
                {uiLanguage === "English" ? "Missing Required Permissions" : "缺少必需权限"}
              </strong>
              <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#a8071a' }}>
                {uiLanguage === "English" 
                  ? `The app is missing these permissions: ${missingScopes.join(", ")}. Orders cannot be loaded without proper permissions.`
                  : `应用缺少以下权限：${missingScopes.join(", ")}。没有正确权限，无法加载订单数据。`}
              </p>
            </div>
          </div>
          {reauthorizeUrl && (
            <button
              onClick={handleReauthorize}
              style={{
                background: '#cf1322',
                color: 'white',
                padding: '8px 16px',
                borderRadius: '4px',
                border: 'none',
                fontWeight: 500,
                whiteSpace: 'nowrap',
                cursor: 'pointer',
              }}
            >
              {uiLanguage === "English" ? "Grant Permissions" : "授权权限"}
            </button>
          )}
        </div>
      )}

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
