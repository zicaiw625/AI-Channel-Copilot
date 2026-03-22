import type { HeadersFunction, LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useSearchParams, useActionData, Form } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { requireEnv } from "../lib/env.server";
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
import { BILLING_PLANS, PRIMARY_BILLABLE_PLAN_ID, type PlanId, validatePlanId, validateAndGetPlan } from "../lib/billing/plans";
import { isDemoMode } from "../lib/runtime.server";
import { OrdersRepository } from "../lib/repositories/orders.repository";
import { resolveDateRange } from "../lib/aiData";
import { logger } from "../lib/logger.server";

// 共享 UI 组件
import { Banner, PlanCard } from "../components/ui";

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
  const { admin, session } = await authenticate.admin(request);
  if (!session?.shop) {
    // 正常情况下 Shopify SDK 会在缺少 session 时触发 OAuth 并返回 Response
    // 这里兜底：避免渲染出 “Unauthorized” 导致新安装用户看不到订阅引导。
    return { language: "中文", authorized: false };
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

/** 价值点标签 */
function ValuePill({ icon, label, sublabel }: { icon: string; label: string; sublabel: string }) {
  return (
    <div style={{ 
      display: "flex", 
      flexDirection: "column", 
      alignItems: "center", 
      padding: "12px 16px",
      background: "#f9fafb",
      borderRadius: 8,
      minWidth: 120,
    }}>
      <span style={{ fontSize: 24, marginBottom: 4 }}>{icon}</span>
      <span style={{ fontSize: 14, fontWeight: 600, color: "#212b36" }}>{label}</span>
      <span style={{ fontSize: 11, color: "#919eab" }}>{sublabel}</span>
    </div>
  );
}

/** Pro 价值说明区块 - 突出漏斗对比为核心卖点 */
function ProValueBanner({ en }: { en: boolean }) {
  return (
    <div
      style={{ 
        maxWidth: 700, 
        margin: "0 auto 24px", 
        padding: "20px 24px", 
        background: "linear-gradient(135deg, #f0f7ff 0%, #e6f4ff 100%)",
        border: "1px solid #91caff",
        borderRadius: 12,
      }}
    >
      <div style={{ textAlign: "center", marginBottom: 16 }}>
        <span style={{ 
          fontSize: 16, 
          color: "#0958d9", 
          fontWeight: 700,
          display: "block",
          marginBottom: 4,
        }}>
          {en ? "🎯 Is AI Traffic High-Intent? See the Funnel." : "🎯 AI 流量是不是高意图？看漏斗。"}
        </span>
        <span style={{ fontSize: 13, color: "#637381" }}>
          {en 
            ? "Visit → Add to Cart → Checkout → Order — Compare AI vs Overall" 
            : "访问 → 加购 → 发起结账 → 成交 — AI 渠道 vs 全站对比"}
        </span>
      </div>
      
      {/* 迷你漏斗预览 */}
      <div style={{ 
        display: "flex", 
        alignItems: "center", 
        justifyContent: "center", 
        gap: 8, 
        marginBottom: 16,
        padding: "12px 16px",
        background: "rgba(255,255,255,0.8)",
        borderRadius: 8,
      }}>
        <FunnelStage label={en ? "Visit" : "访问"} overall="10K" ai="800" />
        <span style={{ color: "#91caff", fontSize: 18 }}>→</span>
        <FunnelStage label={en ? "Cart" : "加购"} overall="2K" ai="240" />
        <span style={{ color: "#91caff", fontSize: 18 }}>→</span>
        <FunnelStage label={en ? "Checkout" : "结账"} overall="800" ai="120" />
        <span style={{ color: "#91caff", fontSize: 18 }}>→</span>
        <FunnelStage label={en ? "Order" : "订单"} overall="400" ai="84" highlight />
      </div>
      
      <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
        <FeatureChip icon="🔍" label={en ? "Evidence chain per order" : "每笔订单证据链"} />
        <FeatureChip icon="📊" label={en ? "Funnel comparison" : "漏斗转化对比"} />
        <FeatureChip icon="📥" label={en ? "CSV export" : "CSV 导出"} />
      </div>
      
      <div style={{ textAlign: "center", marginTop: 12, fontSize: 13, color: "#0958d9", fontWeight: 500 }}>
        {en 
          ? "Pro: Prove AI channel ROI with conversion data" 
          : "Pro 版：用转化数据证明 AI 渠道的 ROI"}
      </div>
    </div>
  );
}

/** 迷你漏斗阶段展示 */
function FunnelStage({ 
  label, 
  overall, 
  ai, 
  highlight = false 
}: { 
  label: string; 
  overall: string; 
  ai: string; 
  highlight?: boolean;
}) {
  return (
    <div style={{ 
      textAlign: "center", 
      padding: "6px 10px",
      background: highlight ? "#e6f7ed" : "transparent",
      borderRadius: 6,
    }}>
      <div style={{ fontSize: 10, color: "#637381", marginBottom: 1 }}>{label}</div>
      <div style={{ fontSize: 12, color: "#212b36" }}>{overall}</div>
      <div style={{ fontSize: 11, color: "#635bff", fontWeight: 600 }}>AI: {ai}</div>
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

/** Growth 价值说明区块 - AI 可见性套件 */
function GrowthValueBanner({ en }: { en: boolean }) {
  return (
    <div
      style={{ 
        maxWidth: 700, 
        margin: "0 auto 24px", 
        padding: "20px 24px", 
        background: "linear-gradient(135deg, #f6ffed 0%, #e6f7ed 100%)",
        border: "1px solid #b7eb8f",
        borderRadius: 12,
      }}
    >
      <div style={{ textAlign: "center", marginBottom: 16 }}>
        <span style={{ 
          fontSize: 16, 
          color: "#389e0d", 
          fontWeight: 700,
          display: "block",
          marginBottom: 4,
        }}>
          {en ? "🚀 Make Your Store AI-Ready" : "🚀 让你的店铺更容易被 AI 推荐"}
        </span>
        <span style={{ fontSize: 13, color: "#637381" }}>
          {en 
            ? "One-click fixes: llms.txt + Schema + FAQ — Complete AI Visibility Suite" 
            : "一键落地：llms.txt + Schema + FAQ — 完整 AI 可见性套件"}
        </span>
      </div>
      
      {/* AI 可见性评分预览 */}
      <div style={{ 
        display: "flex", 
        alignItems: "center", 
        justifyContent: "center", 
        gap: 24, 
        marginBottom: 16,
        padding: "16px 20px",
        background: "rgba(255,255,255,0.9)",
        borderRadius: 8,
      }}>
        <ScorePreview label={en ? "Overall" : "总分"} score={72} color="#52c41a" />
        <ScorePreview label="Schema" score={85} color="#1890ff" />
        <ScorePreview label={en ? "Content" : "内容"} score={68} color="#722ed1" />
        <ScorePreview label="llms.txt" score={60} color="#fa8c16" />
      </div>
      
      <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
        <FeatureChip icon="📝" label={en ? "Auto llms.txt" : "自动 llms.txt"} />
        <FeatureChip icon="🏷️" label={en ? "Schema fixes" : "Schema 修复"} />
        <FeatureChip icon="❓" label={en ? "FAQ suggestions" : "FAQ 建议"} />
        <FeatureChip icon="🏪" label={en ? "Multi-store" : "多店铺"} />
      </div>
      
      <div style={{ textAlign: "center", marginTop: 12, fontSize: 13, color: "#389e0d", fontWeight: 500 }}>
        {en 
          ? "Growth: Not just track AI traffic — actively optimize for it" 
          : "Growth 版：不只追踪 AI 流量 — 主动优化让 AI 更容易推荐你"}
      </div>
    </div>
  );
}

/** AI 可见性评分预览 */
function ScorePreview({ label, score, color }: { label: string; score: number; color: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ 
        width: 48, 
        height: 48, 
        borderRadius: "50%", 
        background: `conic-gradient(${color} ${score}%, #e8e8e8 0)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        margin: "0 auto 6px",
      }}>
        <div style={{ 
          width: 38, 
          height: 38, 
          borderRadius: "50%", 
          background: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 14,
          fontWeight: 700,
          color,
        }}>
          {score}
        </div>
      </div>
      <div style={{ fontSize: 11, color: "#637381" }}>{label}</div>
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
      {/* Hero: 价值主张 */}
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, marginBottom: 12, color: "#212b36", lineHeight: 1.3 }}>
          {en 
            ? "Prove AI Revenue First, Then Optimize for More AI Discovery" 
            : "先验证 AI 是否带单，再继续优化 AI 推荐曝光"}
        </h1>
        <p style={{ fontSize: 16, color: "#637381", marginBottom: 20, maxWidth: 600, margin: "0 auto 20px" }}>
          {en 
            ? "Start by measuring GMV and conversion quality from ChatGPT, Perplexity and other assistants, then unlock llms.txt, Schema and FAQ optimization as you scale." 
            : "先衡量 ChatGPT、Perplexity 等 AI 助手带来的 GMV 和转化质量，再按需开启 llms.txt、Schema 和 FAQ 优化能力。"}
        </p>
        
        {/* 3个核心价值点 - 紧凑版 */}
        <div style={{ 
          display: "flex", 
          gap: 12, 
          justifyContent: "center", 
          marginBottom: 16,
          flexWrap: "wrap",
        }}>
          <ValuePill icon="🔍" label={en ? "Detect AI Orders" : "识别 AI 订单"} sublabel={en ? "Automatic attribution" : "自动归因"} />
          <ValuePill icon="📊" label={en ? "Compare Conversion" : "对比转化率"} sublabel={en ? "AI vs Other traffic" : "AI vs 其他流量"} />
          <ValuePill icon="🚀" label={en ? "Get AI-Ready" : "AI 优化建议"} sublabel={en ? "One-click fixes" : "一键落地"} />
        </div>
        <p style={{ fontSize: 13, color: "#64748b", margin: "0 auto", maxWidth: 680, lineHeight: 1.6 }}>
          {en
            ? "Free helps you verify whether AI traffic is real. Pro proves the funnel. Growth adds the visibility toolkit that helps AI recommend you more often."
            : "Free 版先帮你验证 AI 流量是否真实存在；Pro 版继续证明漏斗和转化；Growth 再补上可见性工具，帮助 AI 更频繁地推荐你。"}
        </p>
        
        {/* 如果有数据，显示简要预览 */}
        {snapshot.hasData && (
          <div style={{ 
            display: "inline-flex", 
            alignItems: "center", 
            gap: 16,
            background: "#f6ffed", 
            border: "1px solid #b7eb8f",
            borderRadius: 24, 
            padding: "8px 20px",
            fontSize: 14,
          }}>
            <span style={{ color: "#389e0d" }}>✓ {en ? "AI orders detected!" : "已检测到 AI 订单！"}</span>
            <span style={{ color: "#333" }}>
              <strong>{formatCurrency(snapshot.aiGMV, snapshot.currency)}</strong> AI GMV · <strong>{snapshot.aiOrders}</strong> {en ? "orders" : "订单"}
            </span>
          </div>
        )}
      </div>
      
      {/* 分隔线 */}
      <div style={{ height: 1, background: "#e0e0e0", margin: "0 auto 24px", maxWidth: 600 }} />
      
      <h2 style={{ textAlign: "center", marginBottom: 8, color: "#212b36", fontSize: 22 }}>
        {en ? "Choose Your Plan" : "选择适合您的计划"}
      </h2>
      <p style={{ textAlign: "center", marginBottom: 20, color: "#637381", fontSize: 14 }}>
        {en 
          ? "Start free, upgrade when you need more" 
          : "免费开始，按需升级"}
      </p>
      
      {/* Pro 价值说明 */}
      <ProValueBanner en={en} />
      
      {/* Growth 价值说明 */}
      <GrowthValueBanner en={en} />
      
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

      {/* 计划卡片 - Free 和 Pro 并排，Growth 全宽 */}
      {(() => {
        const freePlan = (plans ?? []).find((p: PlanWithTrial) => p.id === "free");
        const proPlan = (plans ?? []).find((p: PlanWithTrial) => p.id === "pro");
        const growthPlan = (plans ?? []).find((p: PlanWithTrial) => p.id === "growth");
        
        const renderPlanCard = (plan: PlanWithTrial, isWide = false) => {
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

          if (isWide) {
            // Growth 卡片 - 全宽样式
            return (
              <div
                key={plan.id}
                style={{
                  width: "100%",
                  maxWidth: 700,
                  margin: "0 auto",
                  border: "1px solid #b7eb8f",
                  borderRadius: 8,
                  padding: 24,
                  background: "#fff",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: 18, color: "#212b36" }}>{plan.name}</h3>
                    <p style={{ color: "#637381", margin: "8px 0 0" }}>
                      {en ? plan.includes[0].en : plan.includes[0].zh}
                    </p>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 28, fontWeight: "bold" }}>
                      {priceLabel}
                      <span style={{ fontSize: 14, fontWeight: "normal", color: "#637381" }}>
                        &nbsp;/ {en ? "mo" : "月"}
                      </span>
                    </div>
                  </div>
                </div>
                
                <ul
                  style={{
                    listStyle: "none",
                    padding: 0,
                    margin: "12px 0 16px",
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                    gap: "8px 24px",
                    lineHeight: 1.6,
                  }}
                >
                  {plan.includes.map((f, idx) => (
                    <li key={idx}>✓ {en ? f.en : f.zh}</li>
                  ))}
                </ul>
                
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
                      background: "#389e0d",
                      color: "#fff",
                      border: "none",
                      borderRadius: 4,
                      cursor: disabled ? "not-allowed" : "pointer",
                      fontWeight: 600,
                      boxShadow: "0 2px 5px rgba(0,0,0,0.1)",
                    }}
                  >
                    {buttonLabel}
                  </button>
                </Form>
                
                {trialLabel && (
                  <div style={{ textAlign: "center", fontSize: 12, color: "#637381", marginTop: 8 }}>
                    {trialLabel}
                  </div>
                )}
              </div>
            );
          }

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
        };
        
        return (
          <>
            {/* Free 和 Pro 并排 */}
            <div style={{ display: "flex", gap: 20, justifyContent: "center", flexWrap: "wrap", marginBottom: 20 }}>
              {freePlan && renderPlanCard(freePlan)}
              {proPlan && renderPlanCard(proPlan)}
            </div>
            
            {/* Growth 全宽 */}
            {growthPlan && renderPlanCard(growthPlan, true)}
          </>
        );
      })()}
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
        const appUrl = requireEnv("SHOPIFY_APP_URL");
        throw new Response(null, { status: 302, headers: { Location: `${appUrl}/app` } });
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
