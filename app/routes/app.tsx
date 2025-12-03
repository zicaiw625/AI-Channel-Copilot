import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { useUILanguage } from "../lib/useUILanguage";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate, BILLING_PLAN } from "../shopify.server";
import { requireEnv } from "../lib/env.server";
import { getSettings, syncShopPreferences } from "../lib/settings.server";
import { detectAndPersistDevShop, shouldSkipBillingForPath, computeIsTestMode, markSubscriptionCheck, getTrialRemainingDays, getBillingState } from "../lib/billing.server";
 

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const demo = process.env.DEMO_MODE === "true";
  type AuthShape = Awaited<ReturnType<typeof authenticate.admin>>;
  let admin: AuthShape["admin"] | null = null;
  let billing: AuthShape["billing"] | null = null;
  let session: AuthShape["session"] | null = null;

  try {
    const auth = await authenticate.admin(request);
    admin = auth.admin;
    billing = auth.billing;
    session = auth.session;
  } catch (e) {
    const url = new URL(request.url);
    const path = url.pathname.toLowerCase();
    const allowUnauth = path.includes("/app/onboarding") || path.includes("/app/billing");
    if (!demo && !allowUnauth) throw e;
  }

  const shopDomain = session?.shop || "";
  let settings = await getSettings(shopDomain);
  // 只在有 admin 且有 shopDomain 时同步偏好，避免不必要的调用
  if (admin && shopDomain) {
    settings = await syncShopPreferences(admin, shopDomain, settings);
  }

  try {
    const url = new URL(request.url);
    const isDevShop = admin ? await detectAndPersistDevShop(admin, shopDomain) : false;
    const skipBilling = shouldSkipBillingForPath(url.pathname, isDevShop);
    const billingEnabled = process.env.ENABLE_BILLING === "true";

    if (!billingEnabled) {
      return {
        apiKey: requireEnv("SHOPIFY_API_KEY"),
        language: settings.languages[0] || "中文",
        readOnly: false,
        trialDaysLeft: null,
        isDevShop,
      };
    }

    let readOnly = false;
    let trialDaysLeft: number | null = null;
    const devBanner = isDevShop;

    if (!skipBilling && billing) {
      const state = await getBillingState(shopDomain);
      const ttlMinutes = Number(process.env.BILLING_CHECK_TTL_MINUTES || "10");
      const now = Date.now();
      const fresh = state?.lastCheckedAt && now - state.lastCheckedAt.getTime() < ttlMinutes * 60 * 1000;

      // 检查缓存的订阅状态或 trial 是否仍然有效
      const cachedSubscriptionActive = state?.lastSubscriptionStatus === "active";
      const cachedTrialActive = state?.lastTrialEndAt && state.lastTrialEndAt.getTime() > now;
      const cachedActive = cachedSubscriptionActive || cachedTrialActive;

      if (fresh && cachedActive) {
        // 使用缓存结果，不重新检查
        readOnly = false;
        if (cachedTrialActive && state?.lastTrialEndAt) {
          trialDaysLeft = Math.max(0, Math.ceil((state.lastTrialEndAt.getTime() - now) / (24 * 60 * 60 * 1000)));
        }
      } else {
        // 重新检查订阅状态
        const isTest = await computeIsTestMode(shopDomain);
        const result = await billing.check({ plans: [BILLING_PLAN], isTest });

        // 计算 trial 信息
        const baseTrial = Number(process.env.BILLING_TRIAL_DAYS || "7");
        const hasEverSubscribed = state?.hasEverSubscribed || result.hasActivePayment;
        let trialEnd: Date | null = null;

        if (!hasEverSubscribed && baseTrial > 0) {
          // 首次使用，设置 trial 结束时间
          const installCreatedAt = state?.lastTrialStartAt || new Date();
          trialEnd = new Date(installCreatedAt.getTime() + baseTrial * 24 * 60 * 60 * 1000);
        } else if (state?.lastTrialEndAt) {
          trialEnd = state.lastTrialEndAt;
        }

        // 保存订阅检查结果（包含 trial 信息）
        await markSubscriptionCheck(
          shopDomain,
          result.hasActivePayment ? "active" : "inactive",
          state?.lastTrialStartAt || (hasEverSubscribed ? null : new Date()),
          trialEnd,
          hasEverSubscribed,
        );

        readOnly = !result.hasActivePayment;

        // 检查 trial 是否仍然有效
        if (trialEnd && trialEnd.getTime() > now) {
          trialDaysLeft = Math.max(0, Math.ceil((trialEnd.getTime() - now) / (24 * 60 * 60 * 1000)));
          readOnly = false; // trial 期间不是只读
        }
      }

      // 如果还没有 trialDaysLeft 但需要检查，从数据库再次获取
      if (trialDaysLeft === null) {
        trialDaysLeft = await getTrialRemainingDays(shopDomain);
        if (typeof trialDaysLeft === "number" && trialDaysLeft > 0) {
          readOnly = false;
        }
      }

      const path = url.pathname.toLowerCase();
      const isProtected =
        path === "/app" ||
        (path.startsWith("/app/") &&
          !path.includes("/app/onboarding") &&
          !path.includes("/app/billing") &&
          !path.includes("/app/additional"));

      const trialActive = typeof trialDaysLeft === "number" && trialDaysLeft > 0;

      if (isProtected && readOnly && !trialActive) {
        const next = new URL("/app/onboarding", url.origin);
        next.search = url.search;
        throw new Response(null, { status: 302, headers: { Location: next.toString() } });
      }
    }

    return {
      apiKey: requireEnv("SHOPIFY_API_KEY"),
      language: settings.languages[0] || "中文",
      readOnly,
      trialDaysLeft,
      isDevShop: devBanner,
    };
  } catch (e) {
    if (e instanceof Response) throw e;
    // 发生未知错误时，返回默认非只读状态，避免用户被锁定
    return {
      apiKey: requireEnv("SHOPIFY_API_KEY"),
      language: settings.languages[0] || "中文",
      readOnly: false,
      trialDaysLeft: null,
      isDevShop: false,
    };
  }
};

export default function App() {
  const { apiKey, language, readOnly, trialDaysLeft, isDevShop } = useLoaderData<typeof loader>();
  const uiLanguage = useUILanguage(language);

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">{uiLanguage === "English" ? "AI Dashboard" : "AI 仪表盘"}</s-link>
        <s-link href="/app/additional">{uiLanguage === "English" ? "Settings / Rules & Export" : "设置 / 规则 & 导出"}</s-link>
        <s-link href="/app/billing">{uiLanguage === "English" ? "Subscription" : "订阅与试用"}</s-link>
        {readOnly && (
          <span style={{ marginLeft: 12, color: "#b00" }}>{uiLanguage === "English" ? "Read-only mode (subscribe to unlock)" : "只读模式（订阅以解锁）"}</span>
        )}
        {typeof trialDaysLeft === "number" && trialDaysLeft > 0 && (
          <span style={{ marginLeft: 12, color: "#555" }}>
            {uiLanguage === "English" ? `Trial ${trialDaysLeft} days left` : `试用剩余 ${trialDaysLeft} 天`}
          </span>
        )}
        {isDevShop && (
          <span style={{ marginLeft: 12, color: "#555" }}>
            {uiLanguage === "English" ? "Development store: free testing mode" : "开发店环境：免费测试模式"}
          </span>
        )}
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
