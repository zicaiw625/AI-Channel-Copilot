import { useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useActionData, Form, useFetcher, Link } from "react-router";
import { useUILanguage } from "../lib/useUILanguage";
import { boundary } from "@shopify/shopify-app-react-router/server";
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
  const language = settings.languages[0] || "中文";
  
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
  const trialBannerStyle = activePlanId === "growth"
    ? { background: "#f6ffed", border: "1px solid #b7eb8f", color: "#389e0d" }
    : { background: "#f4f5fa", border: "1px solid #e1e3e5", color: "#5c6ac4" };
  
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
      
      {actionData && actionData.ok === false && (
        <div style={{ marginBottom: 20, padding: 10, background: "#fff2e8", color: "#b25b1a", borderRadius: 4 }}>
          {actionData.message}
        </div>
      )}
      
      {/* 降级操作反馈 */}
      {downgradeResult && (
        <div style={{ 
          marginBottom: 20, 
          padding: 10, 
          background: downgradeResult.ok ? "#e6f7ff" : "#fff2e8", 
          color: downgradeResult.ok ? "#0050b3" : "#b25b1a", 
          borderRadius: 4 
        }}>
          {downgradeResult.ok 
            ? (en ? "Successfully downgraded to Free plan." : "已成功降级到免费版。")
            : (downgradeResult.message || (en ? "Downgrade failed. Please try again." : "降级失败，请重试。"))}
        </div>
      )}
      
      <div style={{ border: "1px solid #e1e3e5", borderRadius: 8, padding: 20, background: "white" }}>
          {/* 尚未选择计划的提示 */}
          {hasNoPlan ? (
            <>
              <div style={{ textAlign: "center", padding: "20px 0" }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>🎯</div>
                <div style={{ fontSize: 18, fontWeight: "bold", marginBottom: 8 }}>
                  {en ? "No plan selected yet" : "尚未选择订阅计划"}
                </div>
                <div style={{ color: "#666", marginBottom: 20 }}>
                  {en 
                    ? "Choose a plan below to start using AI SEO & Discovery" 
                    : "请从下方选择一个计划以开始使用 AI SEO & Discovery"}
                </div>
                <a
                  href="#plans"
                  style={{
                    display: "inline-block",
                    background: "#008060",
                    color: "white",
                    padding: "12px 24px",
                    borderRadius: 4,
                    textDecoration: "none",
                    fontSize: 16,
                    fontWeight: 600,
                  }}
                >
                  {en ? "Choose a Plan" : "选择计划"}
                </a>
              </div>
            </>
          ) : (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                  <div>
                      <div style={{ fontSize: 14, color: "#666", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                          {en ? "Current Plan" : "当前计划"}
                      </div>
                      <div style={{ fontSize: 24, fontWeight: "bold", marginTop: 4 }}>
                          {activePlan.name}
                      </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 24, fontWeight: "bold" }}>
                          {priceLabel}
                          {activePlan.priceUsd > 0 && (
                            <span style={{ fontSize: 14, fontWeight: "normal", color: "#666" }}> / {en ? "mo" : "月"}</span>
                          )}
                      </div>
                  </div>
              </div>

              {showTrialBanner && (
                <div style={{ 
                  marginBottom: 16, 
                  padding: 12, 
                  borderRadius: 8,
                  ...trialBannerStyle,
                }}>
                  <div style={{ fontWeight: 500 }}>
                    ✨ {en
                      ? `Enjoying your ${trialPlanName} trial · ${activePlan.remainingTrialDays} day${activePlan.remainingTrialDays === 1 ? '' : 's'} remaining`
                      : `正在体验 ${trialPlanName} 全部功能 · 剩余 ${activePlan.remainingTrialDays} 天`}
                  </div>
                  {formattedTrialEndDate && (
                    <div style={{ fontSize: 12, marginTop: 4, color: "#637381" }}>
                      {en ? `Your subscription continues on ${formattedTrialEndDate}` : `订阅将于 ${formattedTrialEndDate} 正式生效`}
                    </div>
                  )}
                </div>
              )}
              
              <hr style={{ border: "none", borderTop: "1px solid #eee", margin: "20px 0" }} />
              
              <div style={{ display: "flex", gap: 12 }}>
                  {activePlanId === "free" ? (
                <Form method="post" replace>
                  <input type="hidden" name="intent" value="upgrade" />
                  <input type="hidden" name="planId" value={PRIMARY_BILLABLE_PLAN_ID} />
                  <input type="hidden" name="shop" value={shopDomain} />
                  <button 
                    type="submit"
                    disabled={demo}
                    data-action="billing-upgrade"
                    aria-label={en ? `Upgrade to ${BILLING_PLANS[PRIMARY_BILLABLE_PLAN_ID].name}` : `升级到 ${BILLING_PLANS[PRIMARY_BILLABLE_PLAN_ID].name}`}
                    style={{ 
                        background: "#008060", 
                        color: "white", 
                        border: "none", 
                        padding: "10px 20px", 
                        borderRadius: 4, 
                        cursor: "pointer", 
                        fontSize: 16
                    }}
                  >
                    {en ? `Upgrade to ${BILLING_PLANS[PRIMARY_BILLABLE_PLAN_ID].name}` : `升级到 ${BILLING_PLANS[PRIMARY_BILLABLE_PLAN_ID].name}`}
                  </button>
                </Form>
              ) : (
                 <>
                    {/* For paid plans, send them to Shopify app settings */}
                     <button 
                        type="button"
                        onClick={openShopifyAppSettings}
                        style={{ 
                            background: "white", 
                            color: "#333", 
                            border: "1px solid #ccc", 
                            padding: "10px 20px", 
                            borderRadius: 4, 
                            cursor: "pointer", 
                            fontSize: 16
                        }}
                     >
                         {en ? "Manage in Shopify" : "在 Shopify 中管理"}
                     </button>
                     
                    <button
                       type="button"
                       onClick={handleDowngradeClick}
                       disabled={demo}
                       data-action="billing-downgrade"
                       aria-label={en ? "Downgrade to Free" : "降级到免费版"}
                       style={{
                           background: "none",
                           border: "none",
                           color: "#d4380d",
                           cursor: "pointer",
                           textDecoration: "underline"
                       }}
                     >
                         {en ? "Downgrade to Free" : "降级到免费版"}
                     </button>
                 </>
              )}
              </div>
            </>
          )}
      </div>

      <div id="plans" style={{ marginTop: 32 }}>
        <h3 style={{ marginBottom: 16 }}>{en ? "Available Plans" : "可用方案"}</h3>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {plans
            .filter((plan) => plan.status === "live") // 只显示已上线的计划
            .map((plan) => {
            // 只有在用户真正选择了计划时才标记为 active
            const isActive = !hasNoPlan && plan.id === activePlanId;
            const disabled = demo || isActive;
            return (
              <div
                key={plan.id}
                style={{
                  flex: 1,
                  minWidth: 260,
                  border: isActive ? "2px solid #008060" : "1px solid #e1e3e5",
                  borderRadius: 8,
                  padding: 16,
                  background: "white",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <h4 style={{ margin: 0 }}>{plan.name}</h4>
                  <span style={{ fontWeight: "bold" }}>
                    {plan.priceUsd === 0 ? "$0" : `$${plan.priceUsd}`}
                    {plan.priceUsd > 0 && (
                      <span style={{ color: "#666", fontWeight: "normal" }}> / {en ? "mo" : "月"}</span>
                    )}
                  </span>
                </div>
                <p style={{ color: "#666", fontSize: 14, margin: "8px 0" }}>
                  {plan.trialSupported
                    ? (en ? "Includes free trial" : "包含免费试用")
                    : (en ? "No trial" : "无试用")}
                </p>
                <ul style={{ paddingLeft: 18, margin: "8px 0", color: "#555", fontSize: 14 }}>
                  {plan.includes.slice(0, 3).map((feature, idx) => (
                    <li key={idx}>{en ? feature.en : feature.zh}</li>
                  ))}
                </ul>
                {plan.id === "free" ? (
                  // 如果用户还没选择计划，显示"选择 Free"按钮；否则显示"降级"按钮
                  hasNoPlan ? (
                    <Form method="post" replace>
                      <input type="hidden" name="intent" value="select_free" />
                      <input type="hidden" name="shop" value={shopDomain} />
                      <button
                        type="submit"
                        disabled={demo}
                        data-action="billing-select-plan"
                        data-plan-id={plan.id}
                        aria-label={en ? "Choose Free" : "选择 Free"}
                        style={{
                          width: "100%",
                          padding: "10px",
                          marginTop: 8,
                          background: "white",
                          color: "#333",
                          border: "1px solid #babfc3",
                          borderRadius: 4,
                          cursor: demo ? "not-allowed" : "pointer",
                        }}
                      >
                        {en ? "Choose Free" : "选择 Free"}
                      </button>
                    </Form>
                  ) : (
                    <button
                      type="button"
                      onClick={handleDowngradeClick}
                      disabled={disabled}
                      data-action="billing-select-plan"
                      data-plan-id={plan.id}
                      aria-label={
                        isActive ? (en ? "Current Plan" : "当前方案") : (en ? "Switch to Free" : "切换到免费版")
                      }
                      style={{
                        width: "100%",
                        padding: "10px",
                        marginTop: 8,
                        background: disabled ? "#f5f5f5" : "white",
                        color: disabled ? "#999" : "#333",
                        border: "1px solid #babfc3",
                        borderRadius: 4,
                        cursor: disabled ? "not-allowed" : "pointer",
                      }}
                    >
                      {isActive ? (en ? "Current Plan" : "当前方案") : (en ? "Switch to Free" : "切换到免费版")}
                    </button>
                  )
                ) : (
                  <Form method="post" replace>
                    <input type="hidden" name="intent" value="upgrade" />
                    <input type="hidden" name="planId" value={plan.id} />
                    <input type="hidden" name="shop" value={shopDomain} />
                    <button
                      type="submit"
                      disabled={disabled}
                      data-action="billing-select-plan"
                      data-plan-id={plan.id}
                      aria-label={
                        isActive
                          ? (en ? "Current Plan" : "当前方案")
                          : (en ? `Switch to ${plan.name}` : `切换到 ${plan.name}`)
                      }
                      style={{
                        width: "100%",
                        padding: "10px",
                        marginTop: 8,
                        background: disabled ? "#f5f5f5" : "#008060",
                        color: disabled ? "#999" : "white",
                        border: "none",
                        borderRadius: 4,
                        cursor: disabled ? "not-allowed" : "pointer",
                      }}
                    >
                      {isActive
                        ? (en ? "Current Plan" : "当前方案")
                        : (en ? `Switch to ${plan.name}` : `切换到 ${plan.name}`)}
                    </button>
                  </Form>
                )}
              </div>
            );
          })}
        </div>
      </div>
      
      {demo && (
        <div style={{ marginTop: 20, padding: 10, background: "#e6f7ff", color: "#0050b3", borderRadius: 4 }}>
          {en ? "Demo mode: Billing actions disabled." : "Demo 模式：计费操作已禁用。"}
        </div>
      )}

      {/* Downgrade Confirmation Modal */}
      {showDowngradeModal && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(0, 0, 0, 0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000
        }}>
          <div style={{
            background: "white",
            borderRadius: 12,
            padding: 24,
            maxWidth: 420,
            width: "90%",
            boxShadow: "0 4px 24px rgba(0, 0, 0, 0.15)"
          }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 600 }}>
              {en ? "Confirm Downgrade" : "确认降级"}
            </h3>
            <p style={{ margin: "0 0 20px", color: "#555", lineHeight: 1.5 }}>
              {en
                ? "Are you sure you want to downgrade to Free? You will lose access to detailed history and Copilot."
                : "确定要降级到免费版吗？您将失去历史数据详情和 Copilot 功能。"}
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setShowDowngradeModal(false)}
                style={{
                  padding: "8px 16px",
                  borderRadius: 6,
                  border: "1px solid #ccc",
                  background: "white",
                  cursor: "pointer",
                  fontSize: 14
                }}
              >
                {en ? "Cancel" : "取消"}
              </button>
              <button
                type="button"
                onClick={confirmDowngrade}
                style={{
                  padding: "8px 16px",
                  borderRadius: 6,
                  border: "none",
                  background: "#d72c0d",
                  color: "white",
                  cursor: "pointer",
                  fontSize: 14
                }}
              >
                {en ? "Downgrade" : "确认降级"}
              </button>
            </div>
          </div>
        </div>
      )}
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
