import type { HeadersFunction, LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
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
    if (!demo) throw e;
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
      plans: Object.values(BILLING_PLANS).map((plan) => ({
        ...plan,
        remainingTrialDays: trialMap[plan.id] || 0,
      })), 
      shopDomain, 
      demo,
      apiKey: process.env.SHOPIFY_API_KEY,
      trialEndDate,
      isTrialing,
  };
};

export default function Billing() {
  const { language, currentPlan, plans, shopDomain, demo, apiKey, trialEndDate, isTrialing } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ ok: boolean; message?: string }>();
  const uiLanguage = useUILanguage(language);
  const en = uiLanguage === "English";
  const normalizePlanId = (plan: PlanTier): PlanId =>
    plan === "pro" || plan === "growth" || plan === "free" ? plan : "free";
  const activePlanId = normalizePlanId(currentPlan);
  const activePlan = plans.find((plan) => plan.id === activePlanId) ?? plans[0];
  const priceLabel = activePlan.priceUsd === 0 ? "$0" : `$${activePlan.priceUsd}`;
  const showTrialBanner = isTrialing && activePlan.remainingTrialDays > 0;
  const isTrialExpiringSoon = showTrialBanner && activePlan.remainingTrialDays <= 3;
  
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
  
  const handleUpgrade = (planId: PlanId) => {
    fetcher.submit(
      { intent: "upgrade", shop: shopDomain, planId },
      { method: "post" }
    );
  };

  const handleDowngrade = () => {
      if (confirm(en ? "Are you sure you want to downgrade to Free? You will lose access to detailed history and Copilot." : "确定要降级到免费版吗？您将失去历史数据详情和 Copilot 功能。")) {
        fetcher.submit(
        { intent: "downgrade", shop: shopDomain },
        { method: "post" }
        );
      }
  };
  
  return (
    <section style={{ padding: 20, maxWidth: 800, margin: "0 auto", fontFamily: "system-ui" }}>
      <h2 style={{ marginBottom: 20 }}>{en ? "Subscription Management" : "订阅管理"}</h2>
      
      {fetcher.data && !fetcher.data.ok && (
        <div style={{ marginBottom: 20, padding: 10, background: "#fff2e8", color: "#b25b1a", borderRadius: 4 }}>
          {fetcher.data.message}
        </div>
      )}
      
      <div style={{ border: "1px solid #e1e3e5", borderRadius: 8, padding: 20, background: "white" }}>
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
                  <button 
                    type="button"
                    onClick={() => handleUpgrade(PRIMARY_BILLABLE_PLAN_ID)}
                    disabled={fetcher.state !== "idle" || demo}
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
                      {fetcher.state !== "idle"
                        ? "..."
                        : (en
                            ? `Upgrade to ${BILLING_PLANS[PRIMARY_BILLABLE_PLAN_ID].name}`
                            : `升级到 ${BILLING_PLANS[PRIMARY_BILLABLE_PLAN_ID].name}`)}
                  </button>
              ) : (
                 <>
                    {/* For paid plans, usually we send them to Shopify billing */}
                     <a 
                        href={`https://${shopDomain}/admin/apps/${apiKey}/settings`} 
                        target="_top"
                        style={{ 
                            textDecoration: "none",
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
                     </a>
                     
                    <button
                       type="button"
                       onClick={handleDowngrade}
                       disabled={fetcher.state !== "idle" || demo}
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
      </div>

      <div style={{ marginTop: 32 }}>
        <h3 style={{ marginBottom: 16 }}>{en ? "Available Plans" : "可用方案"}</h3>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {plans.map((plan) => {
            const isActive = plan.id === activePlanId;
            const disabled = fetcher.state !== "idle" || demo || plan.status !== "live" || isActive;
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
                <button
                  type="button"
                  onClick={() => (plan.id === "free" ? handleDowngrade() : handleUpgrade(plan.id))}
                  disabled={disabled}
                  data-action="billing-select-plan"
                  data-plan-id={plan.id}
                  aria-label={
                    isActive
                      ? (en ? "Current Plan" : "当前方案")
                      : plan.status === "coming_soon"
                        ? (en ? "Coming soon" : "敬请期待")
                        : plan.id === "free"
                          ? (en ? "Switch to Free" : "切换到免费版")
                          : (en ? `Switch to ${plan.name}` : `切换到 ${plan.name}`)
                  }
                  style={{
                    width: "100%",
                    padding: "10px",
                    marginTop: 8,
                    background: disabled ? "#f5f5f5" : plan.id === "free" ? "white" : "#008060",
                    color: disabled ? "#999" : plan.id === "free" ? "#333" : "white",
                    border: plan.id === "free" ? "1px solid #babfc3" : "none",
                    borderRadius: 4,
                    cursor: disabled ? "not-allowed" : "pointer",
                  }}
                >
                  {isActive
                    ? (en ? "Current Plan" : "当前方案")
                    : plan.status === "coming_soon"
                      ? (en ? "Coming soon" : "敬请期待")
                      : plan.id === "free"
                        ? (en ? "Switch to Free" : "切换到免费版")
                        : (en ? `Switch to ${plan.name}` : `切换到 ${plan.name}`)}
                </button>
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
    </section>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const demo = readAppFlags().demoMode;
  if (demo) return Response.json({ ok: false, message: "Demo mode" });
  
  try {
    const { admin, session } = await authenticate.admin(request);
    const shopDomain = session?.shop || "";
    const formData = await request.formData();
    const intent = formData.get("intent");
    
    if (intent === "upgrade") {
        const planId = (formData.get("planId") as PlanId) || PRIMARY_BILLABLE_PLAN_ID;
        const plan = BILLING_PLANS[planId];
        if (!plan) {
          return Response.json({ ok: false, message: "Unknown plan" }, { status: 400 });
        }
        if (plan.status !== "live") {
          return Response.json({ ok: false, message: "Plan unavailable" }, { status: 400 });
        }
        if (plan.priceUsd === 0) {
          await activateFreePlan(shopDomain);
          return Response.json({ ok: true });
        }
        const isTest = await computeIsTestMode(shopDomain);
        
        // Check if user already has an active paid subscription (upgrade scenario)
        // In upgrade scenario, don't give trial days
        const currentState = await getBillingState(shopDomain);
        const isUpgradeFromPaid = currentState?.billingState?.includes("ACTIVE") && 
          currentState?.billingPlan !== "free" && 
          currentState?.billingPlan !== "NO_PLAN";
        
        const trialDays = isUpgradeFromPaid ? 0 : await calculateRemainingTrialDays(shopDomain, planId);
        const confirmationUrl = await requestSubscription(admin, shopDomain, planId, isTest, trialDays);
        if (confirmationUrl) {
          throw new Response(null, { status: 302, headers: { Location: confirmationUrl } });
        }
        return Response.json({
          ok: false,
          message: "Failed to create subscription. confirmationUrl is missing.",
        });
    }
    
    if (intent === "downgrade") {
        const paidPlans = Object.values(BILLING_PLANS).filter((plan) => plan.priceUsd > 0);
        let activeDetails: { id: string; planId: PlanId } | null = null;
        for (const plan of paidPlans) {
          const details = await getActiveSubscriptionDetails(admin, plan.shopifyName);
          if (details?.id) {
            activeDetails = { id: details.id, planId: plan.id };
            break;
          }
        }
        if (activeDetails) {
          try {
            await cancelSubscription(admin, activeDetails.id, true);
          } catch (error) {
            console.error(error);
            return Response.json({ ok: false, message: "Failed to cancel subscription in Shopify." }, { status: 500 });
          }
        }
        await activateFreePlan(shopDomain);
        return Response.json({ ok: true });
    }
    
    return null;
  } catch (error) {
    if (error instanceof Response) throw error;
    // 当鉴权失败（例如缺少访问令牌）时，降级到登录流程，保留语言与 Cookie
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

      const forwardReq = new Request(loginUrl.toString(), {
        method: "POST",
        headers: request.headers,
        body: forwardForm,
      });
      const result = await login(forwardReq as any);
      if (result instanceof Response) throw result;
    } catch (e) {
      return Response.json({ ok: false, message: "Action failed." });
    }
    return null;
  }
};
