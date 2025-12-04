import { useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useActionData, Form, useFetcher } from "react-router";
import { useUILanguage } from "../lib/useUILanguage";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate, login } from "../shopify.server";
import { readAppFlags } from "../lib/env.server";
import { getSettings, syncShopPreferences } from "../lib/settings.server";
import {
  detectAndPersistDevShop,
  computeIsTestMode,
  requestSubscription,
  calculateRemainingTrialDays,
  activateFreePlan,
  getActiveSubscriptionDetails,
  cancelSubscription,
  getBillingState,
} from "../lib/billing.server";
import { getEffectivePlan, type PlanTier } from "../lib/access.server";
import { BILLING_PLANS, PRIMARY_BILLABLE_PLAN_ID, type PlanId } from "../lib/billing/plans";

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
      console.warn("Admin operations failed in billing:", (e as Error).message);
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
  const isTrialExpiringSoon = showTrialBanner && activePlan.remainingTrialDays <= 3;
  
  // Modal state for downgrade confirmation
  const [showDowngradeModal, setShowDowngradeModal] = useState(false);
  const downgradeFetcher = useFetcher();
  
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
    <section style={{ padding: 20, maxWidth: 800, margin: "0 auto", fontFamily: "system-ui" }}>
      <h2 style={{ marginBottom: 20 }}>{en ? "Subscription Management" : "订阅管理"}</h2>
      
      {actionData && actionData.ok === false && (
        <div style={{ marginBottom: 20, padding: 10, background: "#fff2e8", color: "#b25b1a", borderRadius: 4 }}>
          {actionData.message}
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
                    ? "Choose a plan below to start using AI Channel Copilot" 
                    : "请从下方选择一个计划以开始使用 AI Channel Copilot"}
                </div>
                <a 
                  href="/app/onboarding?step=plan_selection"
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
                  background: isTrialExpiringSoon ? "#fff2e8" : "#e6f7ff", 
                  border: isTrialExpiringSoon ? "1px solid #ffbb96" : "1px solid #91d5ff",
                  borderRadius: 4, 
                  color: isTrialExpiringSoon ? "#d4380d" : "#0050b3" 
                }}>
                  <div style={{ fontWeight: isTrialExpiringSoon ? "bold" : "normal" }}>
                    {isTrialExpiringSoon ? "⚠️ " : ""}
                    {en
                      ? `Trial: ${activePlan.remainingTrialDays} day${activePlan.remainingTrialDays === 1 ? '' : 's'} remaining`
                      : `试用剩余 ${activePlan.remainingTrialDays} 天`}
                    {isTrialExpiringSoon && (en ? " - Subscribe now to keep your access!" : " - 立即订阅以保持访问权限！")}
                  </div>
                  {formattedTrialEndDate && (
                    <div style={{ fontSize: 12, marginTop: 4, opacity: 0.8 }}>
                      {en ? `Trial ends: ${formattedTrialEndDate}` : `试用结束时间：${formattedTrialEndDate}`}
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

      <div style={{ marginTop: 32 }}>
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
                  {plan.includes.slice(0, 3).map((feature) => (
                    <li key={feature}>{feature}</li>
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

  try {
    const auth = await authenticate.admin(request);
    admin = auth.admin;
    session = auth.session;
    shopDomain = session?.shop || "";
  } catch (authError) {
    try {
      const originalUrl = new URL(request.url);
      const lang = originalUrl.searchParams.get("lang") === "en" ? "en" : "zh";
      const loginUrl = new URL("/auth/login", originalUrl.origin);
      loginUrl.searchParams.set("lang", lang);
      const originalForm = await request.formData().catch(() => new FormData());
      const forwardForm = new FormData();
      if (originalForm.has("shop")) {
        forwardForm.set("shop", String(originalForm.get("shop")));
      }
      const forwardReq = new Request(loginUrl.toString(), { method: "POST", headers: request.headers, body: forwardForm });
      const result = await login(forwardReq as any);
      if (result instanceof Response) throw result;
      return null;
    } catch {
      return Response.json({ ok: false, message: "Action failed." });
    }
  }

  try {
    const formData = await request.formData();
    const intent = formData.get("intent");

    // 处理首次选择 Free 计划（用户还没选择任何计划时）
    if (intent === "select_free") {
      await activateFreePlan(shopDomain);
      return Response.json({ ok: true });
    }

    if (intent === "upgrade") {
      const planId = (formData.get("planId") as PlanId) || PRIMARY_BILLABLE_PLAN_ID;
      const plan = BILLING_PLANS[planId];
      if (!plan) return Response.json({ ok: false, message: "Unknown plan" }, { status: 400 });
      if (plan.status !== "live") return Response.json({ ok: false, message: "Plan unavailable" }, { status: 400 });
      if (plan.priceUsd === 0) {
        await activateFreePlan(shopDomain);
        return Response.json({ ok: true });
      }
      const isTest = await computeIsTestMode(shopDomain);
      const currentState = await getBillingState(shopDomain);
      const isUpgradeFromPaid = currentState?.billingState?.includes("ACTIVE") && currentState?.billingPlan !== "free" && currentState?.billingPlan !== "NO_PLAN";
      const trialDays = isUpgradeFromPaid ? 0 : await calculateRemainingTrialDays(shopDomain, planId);
      const confirmationUrl = await requestSubscription(admin!, shopDomain, planId, isTest, trialDays);
      if (confirmationUrl) {
        const next = new URL("/app/redirect", new URL(request.url).origin);
        next.searchParams.set("to", confirmationUrl);
        throw new Response(null, { status: 302, headers: { Location: next.toString() } });
      }
      return Response.json({ ok: false, message: "Failed to create subscription. confirmationUrl is missing." });
    }

    if (intent === "downgrade") {
      const paidPlans = Object.values(BILLING_PLANS).filter((plan) => plan.priceUsd > 0);
      let activeDetails: { id: string; planId: PlanId } | null = null;
      for (const plan of paidPlans) {
        const details = await getActiveSubscriptionDetails(admin!, plan.shopifyName);
        if (details?.id) { activeDetails = { id: details.id, planId: plan.id }; break; }
      }
      if (activeDetails) {
        try { await cancelSubscription(admin!, activeDetails.id, true); }
        catch { return Response.json({ ok: false, message: "Failed to cancel subscription in Shopify." }, { status: 500 }); }
      }
      await activateFreePlan(shopDomain);
      return Response.json({ ok: true });
    }

    return null;
  } catch (error) {
    if (error instanceof Response) throw error;
    return Response.json({ ok: false, message: "Action failed." });
  }
};
