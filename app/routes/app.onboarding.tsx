import type { HeadersFunction, LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useSearchParams, useActionData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { 
  computeIsTestMode, 
  detectAndPersistDevShop, 
  calculateRemainingTrialDays,
  requestSubscription,
  activateFreePlan,
  listPaidSubscriptions,
  cancelSubscription,
  getBillingState,
} from "../lib/billing.server";
import { getSettings, syncShopPreferences } from "../lib/settings.server";
import { useUILanguage } from "../lib/useUILanguage";
import { resolveUILanguageFromRequest } from "../lib/language.server";
import { BILLING_PLANS, PRIMARY_BILLABLE_PLAN_ID, type PlanId, validatePlanId, validateAndGetPlan } from "../lib/billing/plans";
import { isDemoMode } from "../lib/runtime.server";
import { OrdersRepository } from "../lib/repositories/orders.repository";
import { resolveDateRange } from "../lib/aiData";
import { logger } from "../lib/logger.server";
import { APP_PATHS, buildEmbeddedAppUrl } from "../lib/navigation";
import {
  OnboardingHero,
  OnboardingPlanSelection,
  OnboardingStatusBanners,
} from "../components/onboarding/OnboardingPanels";

// ============================================================================
// Types
// ============================================================================

interface AISnapshot {
  totalOrders: number;
  totalGMV: number;
  aiOrders: number;
  aiGMV: number;
  aiShare: number;
  currency: string;
  hasData: boolean;
}

// ============================================================================
// Loader
// ============================================================================

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const demo = isDemoMode();
  const auth = await authenticate.admin(request);
  if (auth instanceof Response) {
    if (!demo) throw auth;
    // Demo 模式下允许继续渲染引导页（缺少 session 时显示未授权）。
    return { language: resolveUILanguageFromRequest(request, "中文"), authorized: false };
  }
  const { admin, session } = auth;
  if (!session?.shop) {
    // 正常情况下 Shopify SDK 会在缺少 session 时触发 OAuth 并返回 Response
    // 这里兜底：避免渲染出 “Unauthorized” 导致新安装用户看不到订阅引导。
    return { language: resolveUILanguageFromRequest(request, "中文"), authorized: false };
  }

  const shopDomain = session.shop;
  let settings = await getSettings(shopDomain);
  
  if (admin) {
    try {
      settings = await syncShopPreferences(admin, shopDomain, settings);
      await detectAndPersistDevShop(admin, shopDomain);
    } catch (_e) {
      // Continue with cached data
    }
  }

  const trialDaysEntries = await Promise.all(
    (Object.keys(BILLING_PLANS) as PlanId[]).map(async (planId) => {
      const plan = BILLING_PLANS[planId];
      const remaining = plan.trialSupported 
        ? await calculateRemainingTrialDays(shopDomain, planId) 
        : 0;
      return [planId, remaining] as const;
    }),
  );
  const trialDays = Object.fromEntries(trialDaysEntries) as Record<PlanId, number>;
  
  const billingState = await getBillingState(shopDomain);
  const isReinstall = billingState?.lastUninstalledAt != null && billingState?.lastReinstalledAt != null;
  const proTrial = trialDays[PRIMARY_BILLABLE_PLAN_ID] ?? 0;
  // 展示条件放宽到 <=，避免剩余试用天数刚好等于默认值时误判为“无剩余”
  const hasRemainingTrial =
    proTrial > 0 && proTrial <= BILLING_PLANS[PRIMARY_BILLABLE_PLAN_ID].defaultTrialDays;
  const showReinstallTrialBanner = isReinstall && hasRemainingTrial;
  
  const isSubscriptionExpired = billingState?.billingState === "EXPIRED_NO_SUBSCRIPTION";
  const wasSubscribed = billingState?.hasEverSubscribed || false;
  
  // 获取 AI 订单数据预览
  let aiSnapshot: AISnapshot = {
    totalOrders: 0,
    totalGMV: 0,
    aiOrders: 0,
    aiGMV: 0,
    aiShare: 0,
    currency: settings.primaryCurrency || "USD",
    hasData: false,
  };
  
  try {
    const ordersRepo = new OrdersRepository();
    const range = resolveDateRange("30d");
    const stats = await ordersRepo.getAggregateStats(shopDomain, range);
    
    aiSnapshot = {
      totalOrders: stats.total.orders,
      totalGMV: stats.total.gmv,
      aiOrders: stats.ai.orders,
      aiGMV: stats.ai.gmv,
      aiShare: stats.total.gmv > 0 ? (stats.ai.gmv / stats.total.gmv) * 100 : 0,
      currency: settings.primaryCurrency || "USD",
      hasData: stats.total.orders > 0,
    };
  } catch (e) {
    logger.warn("[onboarding] Failed to load AI snapshot", { shopDomain }, { error: e });
  }
  
  return { 
    language: resolveUILanguageFromRequest(request, settings.languages?.[0] || "中文"), 
    shopDomain, 
    authorized: true,
    plans: Object.values(BILLING_PLANS)
      .filter((plan) => plan.status === "live")
      .map((plan) => ({
        ...plan,
        remainingTrialDays: trialDays[plan.id] || 0,
      })),
    showReinstallTrialBanner,
    remainingTrialDays: trialDays[PRIMARY_BILLABLE_PLAN_ID] || 0,
    isSubscriptionExpired,
    wasSubscribed,
    aiSnapshot,
  };
};

// ============================================================================
// Main Component
// ============================================================================

export default function Onboarding() {
  const { 
    language, 
    shopDomain, 
    authorized,
    plans,
    showReinstallTrialBanner,
    remainingTrialDays,
    isSubscriptionExpired,
    wasSubscribed,
    aiSnapshot,
  } = useLoaderData<typeof loader>();
  
  const [searchParams] = useSearchParams();
  const reason = searchParams.get("reason");
  
  const actionData = useActionData<typeof action>() as { ok?: boolean; message?: string } | undefined;
  const uiLanguage = useUILanguage(language);
  const en = uiLanguage === "English";
  
  if (!authorized) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#637381" }}>
        Unauthorized. Please access via Shopify Admin.
      </div>
    );
  }
  
  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat(en ? "en-US" : "zh-CN", {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };
  
  const snapshot = aiSnapshot || { totalOrders: 0, totalGMV: 0, aiOrders: 0, aiGMV: 0, aiShare: 0, currency: "USD", hasData: false };

  // 合并后的单页 onboarding
  return (
    <section style={{ maxWidth: 1000, margin: "40px auto", padding: 20 }}>
      <OnboardingHero en={en} snapshot={snapshot} formatCurrency={formatCurrency} />
      <div style={{ height: 1, background: "#e0e0e0", margin: "0 auto 24px", maxWidth: 600 }} />

      <OnboardingStatusBanners
        en={en}
        isSubscriptionExpired={Boolean(isSubscriptionExpired)}
        wasSubscribed={Boolean(wasSubscribed)}
        reason={reason}
        showReinstallTrialBanner={Boolean(showReinstallTrialBanner)}
        remainingTrialDays={remainingTrialDays ?? 0}
        actionMessage={actionData?.ok === false ? actionData.message : undefined}
      />

      <OnboardingPlanSelection
        en={en}
        plans={plans ?? []}
        shopDomain={shopDomain ?? ""}
        recommendedPlanId={PRIMARY_BILLABLE_PLAN_ID}
      />
    </section>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

// ============================================================================
// Action
// ============================================================================

export const action = async ({ request }: ActionFunctionArgs) => {
  const demo = isDemoMode();
  
  if (demo) {
    return Response.json({
      ok: false,
      message: "Demo mode: billing is disabled.",
    });
  }
  
  try {
    const auth = await authenticate.admin(request);
    if (auth instanceof Response) throw auth;
    const { admin, session } = auth;
    const shopDomain = session?.shop || "";
    const url = new URL(request.url);
    const returnUrlContext = {
      host: url.searchParams.get("host"),
      embedded: url.searchParams.get("embedded"),
      locale: url.searchParams.get("locale"),
    };
    const formData = await request.formData();
    const intent = formData.get("intent");
    
    if (intent === "select_plan") {
      const rawPlanId = formData.get("planId");
      const planId = validatePlanId(rawPlanId) || "free";
      const plan = validateAndGetPlan(planId);
      
      if (!plan) {
        return Response.json({ ok: false, message: "Invalid or unknown plan ID" }, { status: 400 });
      }

      if (plan.id === "free") {
        await activateFreePlan(shopDomain);
        const next = buildEmbeddedAppUrl(request.url, APP_PATHS.aiSeoWorkspace, returnUrlContext);
        next.searchParams.set("tab", "llms");
        throw new Response(null, { status: 302, headers: { Location: next.toString() } });
      }

      if (plan.status !== "live") {
        return Response.json({
          ok: false,
          message: plan.status === "coming_soon" ? "Plan is coming soon" : "Plan unavailable",
        }, { status: 400 });
      }

      // 防止重复订阅：先清理已存在的付费订阅（含重复/旧计划）
      try {
        const paidSubs = await listPaidSubscriptions(admin, shopDomain);
        const targetSubs = paidSubs.filter((sub) => sub.planId === planId);
        const pendingTarget = targetSubs.find((sub) => sub.status === "PENDING");
        if (pendingTarget) {
          return Response.json({
            ok: false,
            message: "Subscription pending in Shopify. Please complete it in Shopify before upgrading again.",
          }, { status: 409 });
        }

        let keepTarget: typeof paidSubs[number] | null = null;
        const activeTarget = targetSubs.filter((sub) => sub.status === "ACTIVE");
        if (activeTarget.length > 0) {
          activeTarget.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
          keepTarget = activeTarget[0];
        }

        const toCancel = paidSubs.filter((sub) => !keepTarget || sub.id !== keepTarget.id);
        for (const sub of toCancel) {
          await cancelSubscription(admin, sub.id, true);
        }

        if (keepTarget) {
          return Response.json({ ok: true });
        }
      } catch (_e) {
        return Response.json({
          ok: false,
          message: "Failed to cancel existing subscription in Shopify. Please try again or manage it in Shopify.",
        }, { status: 500 });
      }

      // 关键：在创建订阅前刷新开发店标记，避免 dev store 误发 real charge（会在 approve 时被 Shopify 拒绝）
      try {
        await detectAndPersistDevShop(admin, shopDomain);
      } catch (_e) {
        // 忽略：后续 requestSubscription 内部也会做兜底判定
      }

      const isTest = await computeIsTestMode(shopDomain);
      const trialDays = await calculateRemainingTrialDays(shopDomain, planId);

      const confirmationUrl = await requestSubscription(
        admin,
        shopDomain,
        planId,
        isTest,
        trialDays,
        returnUrlContext,
      );

      if (confirmationUrl) {
        const next = new URL("/app/redirect", new URL(request.url).origin);
        next.searchParams.set("to", confirmationUrl);
        next.searchParams.set("shop", shopDomain);
        const url = new URL(request.url);
        const host = url.searchParams.get("host");
        const embedded = url.searchParams.get("embedded");
        const locale = url.searchParams.get("locale");
        if (host) next.searchParams.set("host", host);
        if (embedded) next.searchParams.set("embedded", embedded);
        if (locale) next.searchParams.set("locale", locale);
        throw new Response(null, { status: 302, headers: { Location: next.toString() } });
      } else {
        return Response.json({
          ok: false,
          message: "Failed to create subscription. confirmationUrl is missing.",
        });
      }
    }

    return null;
  } catch (error) {
    if (error instanceof Response) throw error;
    logger.error("[onboarding] Action failed", { intent: "select_plan" }, { error });
    return Response.json({
      ok: false,
      message: "Action failed. Please try again.",
    });
  }
};
