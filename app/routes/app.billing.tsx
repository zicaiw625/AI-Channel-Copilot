import { useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useActionData, useFetcher } from "react-router";
import { useUILanguage } from "../lib/useUILanguage";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  BillingCurrentPlanCard,
  BillingDemoBanner,
  BillingFeedbackBanners,
  BillingIntro,
  BillingPlansSection,
  DowngradeConfirmationModal,
} from "../components/billing/BillingPanels";
import { authenticate } from "../shopify.server";
import { readAppFlags } from "../lib/env.server";
import { getSettings, syncShopPreferences } from "../lib/settings.server";
import {
  detectAndPersistDevShop,
  computeIsTestMode,
  requestSubscription,
  calculateRemainingTrialDays,
  activateFreePlan,
  listPaidSubscriptions,
  cancelSubscription,
  getBillingState,
} from "../lib/billing.server";
import { getEffectivePlan, type PlanTier } from "../lib/access.server";
import { BILLING_PLANS, PRIMARY_BILLABLE_PLAN_ID, type PlanId, validatePlanId, validateAndGetPlan } from "../lib/billing/plans";
import { buildEmbeddedAppUrl } from "../lib/navigation";
import { resolveUILanguageFromRequest } from "../lib/language.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { demoMode } = readAppFlags();
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
    // authenticate.admin 在缺少会话/需要 OAuth 时可能通过抛出 Response 触发重定向；
    // 仅在非 demo 模式放行，否则 demo 流程会被 OAuth/redirect 打断。
    if (e instanceof Response) {
      if (!demo) throw e;
    }
    authFailed = true;
  }
  
  const shopDomain = session?.shop || "";
  let settings = await getSettings(shopDomain);
  
  // Only use admin if authentication succeeded
  if (admin && !authFailed) {
    try {
      settings = await syncShopPreferences(admin, shopDomain, settings);
      await detectAndPersistDevShop(admin, shopDomain);
    } catch (e) {
      // Log error but continue - cached data will be used
    }
  }
  
  const planTier = await getEffectivePlan(shopDomain);
  const trialEntries = await Promise.all(
    (Object.keys(BILLING_PLANS) as PlanId[]).map(async (planId) => {
      const plan = BILLING_PLANS[planId];
      const remaining = plan.trialSupported ? await calculateRemainingTrialDays(shopDomain, planId) : 0;
      return [planId, remaining] as const;
    }),
  );
  const trialMap = Object.fromEntries(trialEntries) as Record<PlanId, number>;
  const language = resolveUILanguageFromRequest(request, settings.languages?.[0] || "中文");
  
  // Get billing state for trial end date
  const billingState = await getBillingState(shopDomain);
  const trialEndDate = billingState?.lastTrialEndAt?.toISOString() || null;
  const isTrialing = billingState?.billingState?.includes("TRIALING") || false;
  
  return { 
      language, 
      currentPlan: planTier, 
      plans: Object.values(BILLING_PLANS)
        .filter((plan) => plan.status === "live") // 只显示已上线的计划
        .map((plan) => ({
          ...plan,
          remainingTrialDays: trialMap[plan.id] || 0,
        })), 
      shopDomain, 
      demo,
      trialEndDate,
      isTrialing,
  };
};

export default function Billing() {
  const { language, currentPlan, plans, shopDomain, demo, trialEndDate, isTrialing } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as { ok?: boolean; message?: string } | undefined;
  const uiLanguage = useUILanguage(language);
  const en = uiLanguage === "English";
  
  // 打开 Shopify 应用管理页面
  const openShopifyAppSettings = () => {
    // 导航到商店的应用和销售渠道设置页面，用户可以在那里管理应用订阅
    window.open(`https://${shopDomain}/admin/settings/apps`, "_top");
  };
  // 检查用户是否还没选择任何计划
  const hasNoPlan = currentPlan === "none";
  
  const normalizePlanId = (plan: PlanTier): PlanId =>
    plan === "pro" || plan === "growth" || plan === "free" ? plan : "free";
  const activePlanId = normalizePlanId(currentPlan);
  const activePlan = plans.find((plan) => plan.id === activePlanId) ?? plans[0];
  const priceLabel = activePlan.priceUsd === 0 ? "$0" : `$${activePlan.priceUsd}`;
  const showTrialBanner = isTrialing && activePlan.remainingTrialDays > 0 && !hasNoPlan;
  const trialPlanName = activePlan?.name || BILLING_PLANS[PRIMARY_BILLABLE_PLAN_ID].name;
  
  // Modal state for downgrade confirmation
  const [showDowngradeModal, setShowDowngradeModal] = useState(false);
  const downgradeFetcher = useFetcher<{ ok: boolean; message?: string }>();
  
  // 显示降级操作的反馈消息
  const downgradeResult = downgradeFetcher.data;
  
  // Format trial end date
  const formattedTrialEndDate = trialEndDate
    ? new Intl.DateTimeFormat(en ? "en-US" : "zh-CN", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(trialEndDate))
    : null;
  
  const handleDowngradeClick = () => {
      setShowDowngradeModal(true);
  };
  
  const confirmDowngrade = () => {
      downgradeFetcher.submit(
          { intent: "downgrade", shop: shopDomain },
          { method: "post" }
      );
      setShowDowngradeModal(false);
  };
  
  return (
    <s-page heading={en ? "Billing" : "计费管理"}>
      <section style={{ padding: 20, maxWidth: 800, margin: "0 auto", fontFamily: "system-ui" }}>
      <BillingFeedbackBanners
        en={en}
        actionMessage={actionData?.ok === false ? actionData.message : undefined}
        downgradeResult={downgradeResult}
      />

      <BillingIntro en={en} />

      <BillingCurrentPlanCard
        en={en}
        hasNoPlan={hasNoPlan}
        activePlan={activePlan}
        activePlanId={activePlanId}
        priceLabel={priceLabel}
        showTrialBanner={showTrialBanner}
        formattedTrialEndDate={formattedTrialEndDate}
        trialPlanName={trialPlanName}
        demo={demo}
        shopDomain={shopDomain}
        primaryPlanName={BILLING_PLANS[PRIMARY_BILLABLE_PLAN_ID].name}
        primaryPlanId={PRIMARY_BILLABLE_PLAN_ID}
        onOpenShopifyAppSettings={openShopifyAppSettings}
        onRequestDowngrade={handleDowngradeClick}
      />

      <BillingPlansSection
        en={en}
        plans={plans}
        activePlanId={activePlanId}
        hasNoPlan={hasNoPlan}
        demo={demo}
        shopDomain={shopDomain}
        onRequestDowngrade={handleDowngradeClick}
      />

      <BillingDemoBanner en={en} demo={demo} />

      <DowngradeConfirmationModal
        en={en}
        open={showDowngradeModal}
        onCancel={() => setShowDowngradeModal(false)}
        onConfirm={confirmDowngrade}
      />
      </section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const demo = readAppFlags().demoMode;
  if (demo) return Response.json({ ok: false, message: "Demo mode" });
  
  let admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"] | null = null;
  let session: Awaited<ReturnType<typeof authenticate.admin>>["session"] | null = null;
  let shopDomain = "";
  const urlForContext = new URL(request.url);
  const returnUrlContext = {
    host: urlForContext.searchParams.get("host"),
    embedded: urlForContext.searchParams.get("embedded"),
    locale: urlForContext.searchParams.get("locale"),
  };

  try {
    const auth = await authenticate.admin(request);
    admin = auth.admin;
    session = auth.session;
    shopDomain = session?.shop || "";
  } catch (authError) {
    // 同步放行 authenticate.admin 可能抛出的 OAuth/重定向 Response
    if (authError instanceof Response) throw authError;
    // 生产环境禁止 /auth/login（会返回 404）。这里直接走标准 /auth OAuth 流程。
    const originalForm = await request.formData().catch(() => new FormData());
    const shop = originalForm.get("shop") ? String(originalForm.get("shop")) : "";
    if (!shop) return Response.json({ ok: false, message: "Missing shop." }, { status: 400 });
    const next = new URL("/auth", urlForContext.origin);
    next.searchParams.set("shop", shop);
    if (returnUrlContext.host) next.searchParams.set("host", returnUrlContext.host);
    if (returnUrlContext.embedded) next.searchParams.set("embedded", returnUrlContext.embedded);
    if (returnUrlContext.locale) next.searchParams.set("locale", returnUrlContext.locale);
    throw new Response(null, { status: 302, headers: { Location: next.toString() } });
  }

  try {
    const formData = await request.formData();
    const intent = formData.get("intent");

    // 处理首次选择 Free 计划（用户还没选择任何计划时）
    if (intent === "select_free") {
      await activateFreePlan(shopDomain);
      const next = buildEmbeddedAppUrl(request.url, "/app/ai-visibility", returnUrlContext);
      next.searchParams.set("tab", "llms");
      throw new Response(null, { status: 302, headers: { Location: next.toString() } });
    }

    if (intent === "upgrade") {
      // 使用类型安全的 planId 验证，防止恶意输入
      const rawPlanId = formData.get("planId");
      const planId = validatePlanId(rawPlanId) || PRIMARY_BILLABLE_PLAN_ID;
      const plan = validateAndGetPlan(planId);
      if (!plan) return Response.json({ ok: false, message: "Invalid or unknown plan ID" }, { status: 400 });
      if (plan.status !== "live") return Response.json({ ok: false, message: "Plan unavailable" }, { status: 400 });
      if (plan.priceUsd === 0) {
        await activateFreePlan(shopDomain);
        const next = buildEmbeddedAppUrl(request.url, "/app/ai-visibility", returnUrlContext);
        next.searchParams.set("tab", "llms");
        throw new Response(null, { status: 302, headers: { Location: next.toString() } });
      }

      // 防止重复订阅：先清理已存在的付费订阅（含重复/旧计划）
      try {
        const paidSubs = await listPaidSubscriptions(admin!, shopDomain);
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
          await cancelSubscription(admin!, sub.id, true);
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
        await detectAndPersistDevShop(admin!, shopDomain);
      } catch (_e) {
        // 忽略：requestSubscription 内部也会做兜底判定
      }

      const isTest = await computeIsTestMode(shopDomain);
      const currentState = await getBillingState(shopDomain);
      const isUpgradeFromPaid = currentState?.billingState?.includes("ACTIVE") && currentState?.billingPlan !== "free" && currentState?.billingPlan !== "NO_PLAN";
      const trialDays = isUpgradeFromPaid ? 0 : await calculateRemainingTrialDays(shopDomain, planId);
      const confirmationUrl = await requestSubscription(admin!, shopDomain, planId, isTest, trialDays, returnUrlContext);
      if (confirmationUrl) {
        const next = new URL("/app/redirect", new URL(request.url).origin);
        next.searchParams.set("to", confirmationUrl);
        next.searchParams.set("shop", shopDomain);
        if (returnUrlContext.host) next.searchParams.set("host", returnUrlContext.host);
        if (returnUrlContext.embedded) next.searchParams.set("embedded", returnUrlContext.embedded);
        if (returnUrlContext.locale) next.searchParams.set("locale", returnUrlContext.locale);
        throw new Response(null, { status: 302, headers: { Location: next.toString() } });
      }
      return Response.json({ ok: false, message: "Failed to create subscription. confirmationUrl is missing." });
    }

    if (intent === "downgrade") {
      // Step 1: 查找并取消所有活跃的付费订阅（防止遗留重复订阅）
      let shopifyCancelled = false;
      try {
        const paidSubs = await listPaidSubscriptions(admin!, shopDomain);
        for (const sub of paidSubs) {
          await cancelSubscription(admin!, sub.id, true);
        }
        shopifyCancelled = paidSubs.length > 0;
      } catch (_cancelError) {
        // Shopify 取消失败，不继续操作本地状态
        return Response.json({ 
          ok: false, 
          message: "Failed to cancel subscription in Shopify. Please try again or contact support." 
        }, { status: 500 });
      }
      
      // Step 2: Shopify 取消成功（或无订阅需要取消），更新本地状态
      try {
        await activateFreePlan(shopDomain);
      } catch (_localError) {
        // 本地状态更新失败，但 Shopify 已取消
        // 返回部分成功（用户需要刷新页面）
        
        if (shopifyCancelled) {
          // Shopify 已取消，但本地状态未更新 - 返回成功但带警告
          return Response.json({ 
            ok: true, 
            message: "Subscription cancelled in Shopify. Please refresh the page to see updated status." 
          });
        }
        return Response.json({ 
          ok: false, 
          message: "Failed to update subscription status. Please refresh and try again." 
        }, { status: 500 });
      }
      
      return Response.json({ ok: true });
    }

    return null;
  } catch (error) {
    if (error instanceof Response) throw error;
    return Response.json({ ok: false, message: "Action failed." });
  }
};
