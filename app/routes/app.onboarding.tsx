import type { HeadersFunction, LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useSearchParams, useActionData, Form, Link } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { requireEnv } from "../lib/env.server";
import { 
  computeIsTestMode, 
  detectAndPersistDevShop, 
  calculateRemainingTrialDays,
  requestSubscription,
  activateFreePlan,
  getBillingState,
} from "../lib/billing.server";
import { getSettings, syncShopPreferences } from "../lib/settings.server";
import { useUILanguage } from "../lib/useUILanguage";
import { BILLING_PLANS, PRIMARY_BILLABLE_PLAN_ID, type PlanId, validatePlanId, validateAndGetPlan } from "../lib/billing/plans";
import { isDemoMode } from "../lib/runtime.server";
import { OrdersRepository } from "../lib/repositories/orders.repository";
import { resolveDateRange } from "../lib/aiData";
import { logger } from "../lib/logger.server";

// 共享 UI 组件
import { Banner, Card, StatCard, ProgressBar, PlanCard } from "../components/ui";

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

interface PlanWithTrial {
  id: PlanId;
  name: string;
  shopifyName: string;
  priceUsd: number;
  interval: string;
  trialSupported: boolean;
  defaultTrialDays: number;
  includes: { en: string; zh: string }[];
  status: "live" | "coming_soon";
  remainingTrialDays: number;
}

// ============================================================================
// Loader
// ============================================================================

export const loader = async ({ request }: LoaderFunctionArgs) => {
  type AuthShape = Awaited<ReturnType<typeof authenticate.admin>>;
  let admin: AuthShape["admin"] | null = null;
  let session: AuthShape["session"] | null = null;
  let authFailed = false;
  
  try {
    const auth = await authenticate.admin(request);
    admin = auth.admin;
    session = auth.session;
  } catch (_error) {
    authFailed = true;
  }
  
  if (!session) return { language: "中文", authorized: false };

  const shopDomain = session.shop;
  let settings = await getSettings(shopDomain);
  
  if (admin && !authFailed) {
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
  const hasRemainingTrial = proTrial > 0 && proTrial < BILLING_PLANS[PRIMARY_BILLABLE_PLAN_ID].defaultTrialDays;
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
    language: settings.languages[0] || "中文", 
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
// Sub-components
// ============================================================================

/** 价值预览步骤 */
function ValueSnapshotStep({
  snapshot,
  en,
  formatCurrency,
  nextUrl,
}: {
  snapshot: AISnapshot;
  en: boolean;
  formatCurrency: (amount: number, currency: string) => string;
  nextUrl: string;
}) {
  return (
    <section style={{ maxWidth: 600, margin: "40px auto", padding: 20, textAlign: "center" }}>
      <h1 style={{ fontSize: 24, marginBottom: 16, color: "#212b36" }}>
        {en ? "Uncover Your Hidden AI Revenue" : "发现被隐藏的 AI 渠道收入"}
      </h1>
      
      <Card padding="loose">
        <p style={{ fontSize: 16, color: "#637381", marginBottom: 24, textAlign: "center" }}>
          {en 
            ? "We analyze your orders to tell you exactly how much GMV comes from ChatGPT, Perplexity, and others." 
            : "我们通过分析订单来源，告诉您究竟有多少销售额来自 ChatGPT、Perplexity 等 AI 渠道。"}
        </p>
        
        {snapshot.hasData ? (
          <div style={{ background: "#f9fafb", borderRadius: 8, padding: 24 }}>
            <div style={{ fontSize: 12, color: "#919eab", marginBottom: 16 }}>
              {en ? "Last 30 Days" : "最近 30 天"}
            </div>
            
            <div style={{ display: "flex", justifyContent: "space-around", gap: 16, marginBottom: 20 }}>
              <StatCard
                label={en ? "AI Revenue" : "AI 渠道收入"}
                value={formatCurrency(snapshot.aiGMV, snapshot.currency)}
                color="#008060"
              />
              <StatCard
                label={en ? "AI Orders" : "AI 订单数"}
                value={snapshot.aiOrders}
                color="#635bff"
              />
              <StatCard
                label={en ? "AI Share" : "AI 占比"}
                value={`${snapshot.aiShare.toFixed(1)}%`}
                color="#00a2ff"
              />
            </div>
            
            <ProgressBar
              value={snapshot.aiShare}
              showLabel
              label={en 
                ? `${snapshot.aiShare.toFixed(1)}% of total ${formatCurrency(snapshot.totalGMV, snapshot.currency)} GMV`
                : `占总 GMV ${formatCurrency(snapshot.totalGMV, snapshot.currency)} 的 ${snapshot.aiShare.toFixed(1)}%`}
            />
          </div>
        ) : (
          <div
            style={{
              background: "#f9fafb",
              borderRadius: 8,
              padding: 32,
              border: "1px dashed #c4cdd5",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 48, marginBottom: 12 }}>🔍</div>
            <div style={{ color: "#637381" }}>
              {en 
                ? "No order data yet. Complete setup to start tracking AI revenue."
                : "暂无订单数据。完成设置后即可开始追踪 AI 渠道收入。"}
            </div>
          </div>
        )}
      </Card>
      
      <div style={{ marginTop: 24 }}>
        <Link 
          to={nextUrl}
          data-action="onboarding-next-plan"
          aria-label={en ? "Next: Choose a Plan" : "下一步：选择方案"}
          style={{ 
            display: "inline-block",
            background: "#008060", 
            color: "#fff", 
            padding: "12px 24px", 
            borderRadius: 4, 
            fontSize: 16, 
            fontWeight: 500,
            textDecoration: "none",
          }}
        >
          {en ? "Next: Choose a Plan" : "下一步：选择方案"}
        </Link>
      </div>
    </section>
  );
}

/** Pro 价值说明区块 */
function ProValueBanner({ en }: { en: boolean }) {
  return (
    <div
      style={{ 
        maxWidth: 700, 
        margin: "0 auto 24px", 
        padding: "16px 20px", 
        background: "linear-gradient(135deg, #f0f7ff 0%, #e6f4ff 100%)",
        border: "1px solid #91caff",
        borderRadius: 12,
      }}
    >
      <div style={{ textAlign: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 14, color: "#0958d9", fontWeight: 600 }}>
          {en ? "💡 Why upgrade to Pro?" : "💡 为什么升级到 Pro？"}
        </span>
      </div>
      <div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
        <FeatureChip icon="🔍" label={en ? "Evidence chain for every AI order" : "每笔 AI 订单的证据链"} />
        <FeatureChip icon="📊" label={en ? "Full conversion funnel" : "完整转化漏斗"} />
        <FeatureChip icon="📥" label={en ? "CSV data export" : "CSV 数据导出"} />
      </div>
      <div style={{ textAlign: "center", marginTop: 10, fontSize: 12, color: "#637381" }}>
        {en 
          ? "Prove AI channel ROI to your team with real data" 
          : "用真实数据向团队证明 AI 渠道的 ROI"}
      </div>
    </div>
  );
}

/** 功能标签 */
function FeatureChip({ icon, label }: { icon: string; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#333" }}>
      <span>{icon}</span>
      <span>{label}</span>
    </div>
  );
}

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
  const step = searchParams.get("step") || "value_snapshot";
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
  
  // 步骤 1: 价值预览
  if (step === "value_snapshot") {
    const nextUrl = `?${(() => {
      const p = new URLSearchParams(searchParams);
      p.set("step", "plan_selection");
      return p.toString();
    })()}`;
    
    return (
      <ValueSnapshotStep
        snapshot={aiSnapshot || { totalOrders: 0, totalGMV: 0, aiOrders: 0, aiGMV: 0, aiShare: 0, currency: "USD", hasData: false }}
        en={en}
        formatCurrency={formatCurrency}
        nextUrl={nextUrl}
      />
    );
  }

  // 步骤 2: 计划选择
  return (
    <section style={{ maxWidth: 900, margin: "40px auto", padding: 20 }}>
      <h2 style={{ textAlign: "center", marginBottom: 16, color: "#212b36" }}>
        {en ? "Choose Your Plan" : "选择适合您的计划"}
      </h2>
      
      {/* Pro 价值说明 */}
      <ProValueBanner en={en} />
      
      {/* 状态提示 Banners */}
      <div style={{ maxWidth: 700, margin: "0 auto 20px", display: "flex", flexDirection: "column", gap: 12 }}>
        {isSubscriptionExpired && (
          <Banner status="warning" title={en ? "Your subscription has ended" : "您的订阅已结束"}>
            {wasSubscribed 
              ? (en ? "Your paid subscription has been cancelled. Choose a plan below to continue." : "您的付费订阅已取消。请选择一个计划以继续使用。")
              : (en ? "Your trial has ended. Choose a plan below to continue." : "您的试用期已结束。请选择一个计划以继续使用。")}
          </Banner>
        )}
        
        {reason === "subscription_declined" && (
          <Banner status="critical" title={en ? "Subscription not completed" : "订阅未完成"}>
            {en 
              ? "The subscription was not confirmed. Please try again or choose a different plan."
              : "订阅确认未完成。请重试或选择其他计划。"}
          </Banner>
        )}
        
        {showReinstallTrialBanner && !isSubscriptionExpired && (
          <Banner status="info" title={en ? "🎉 Welcome back!" : "🎉 欢迎回来！"}>
            {en 
              ? `You still have ${remainingTrialDays} days of Pro trial remaining. Pick up where you left off!`
              : `您还有 ${remainingTrialDays} 天的 Pro 试用期。继续您的体验吧！`}
          </Banner>
        )}
        
        {actionData && actionData.ok === false && (
          <Banner status="critical">{actionData.message}</Banner>
        )}
      </div>

      {/* 计划卡片 */}
      <div style={{ display: "flex", gap: 20, justifyContent: "center", flexWrap: "wrap" }}>
        {(plans ?? []).map((plan: PlanWithTrial) => {
          const isFree = plan.id === "free";
          const recommended = plan.id === PRIMARY_BILLABLE_PLAN_ID;
          const disabled = plan.status !== "live";
          const priceLabel = plan.priceUsd === 0 ? "$0" : `$${plan.priceUsd}`;
          
          const trialLabel = plan.trialSupported
            ? plan.remainingTrialDays > 0
              ? en ? `${plan.remainingTrialDays} days free` : `剩余 ${plan.remainingTrialDays} 天试用`
              : en ? "Trial exhausted" : "试用次数已用完"
            : undefined;
            
          const buttonLabel = plan.status === "coming_soon"
            ? (en ? "Coming soon" : "敬请期待")
            : en ? `Choose ${plan.name}` : `选择 ${plan.name}`;

          return (
            <PlanCard
              key={plan.id}
              name={plan.name}
              price={priceLabel}
              period={plan.priceUsd > 0 ? (en ? "mo" : "月") : undefined}
              description={en ? plan.includes[0].en : plan.includes[0].zh}
              features={plan.includes.map((f) => (en ? f.en : f.zh))}
              recommended={recommended}
              comingSoon={plan.status === "coming_soon"}
              disabled={disabled}
              trialLabel={trialLabel}
              buttonLabel={buttonLabel}
              en={en}
            >
              <Form method="post" replace>
                <input type="hidden" name="intent" value="select_plan" />
                <input type="hidden" name="planId" value={plan.id} />
                <input type="hidden" name="shop" value={shopDomain} />
                <button
                  type="submit"
                  disabled={disabled}
                  data-action="onboarding-select-plan"
                  data-plan-id={plan.id}
                  aria-label={disabled
                    ? (en ? "Disabled" : "不可用")
                    : (en ? `Choose ${plan.name}` : `选择 ${plan.name}`)}
                  style={{
                    width: "100%",
                    padding: 12,
                    background: isFree ? "#fff" : "#008060",
                    color: isFree ? "#212b36" : "#fff",
                    border: isFree ? "1px solid #babfc3" : "none",
                    borderRadius: 4,
                    cursor: disabled ? "not-allowed" : "pointer",
                    fontWeight: 600,
                    boxShadow: isFree ? "none" : "0 2px 5px rgba(0,0,0,0.1)",
                  }}
                >
                  {buttonLabel}
                </button>
              </Form>
            </PlanCard>
          );
        })}
      </div>
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
    const { admin, session } = await authenticate.admin(request);
    const shopDomain = session?.shop || "";
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
        const appUrl = requireEnv("SHOPIFY_APP_URL");
        throw new Response(null, { status: 302, headers: { Location: `${appUrl}/app` } });
      }

      if (plan.status !== "live") {
        return Response.json({
          ok: false,
          message: plan.status === "coming_soon" ? "Plan is coming soon" : "Plan unavailable",
        }, { status: 400 });
      }

      const isTest = await computeIsTestMode(shopDomain);
      const trialDays = await calculateRemainingTrialDays(shopDomain, planId);

      const confirmationUrl = await requestSubscription(
        admin,
        shopDomain,
        planId,
        isTest,
        trialDays,
      );

      if (confirmationUrl) {
        const next = new URL("/app/redirect", new URL(request.url).origin);
        next.searchParams.set("to", confirmationUrl);
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
