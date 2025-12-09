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

/** 价值预览步骤 - 7天验证AI是否带单 */
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
    <section style={{ maxWidth: 680, margin: "40px auto", padding: 20, textAlign: "center" }}>
      {/* 主标题 - 强调7天验证承诺 */}
      <h1 style={{ fontSize: 28, marginBottom: 12, color: "#212b36", lineHeight: 1.3 }}>
        {en 
          ? "Prove AI is Driving Sales — In Just 7 Days" 
          : "7 天内验证：AI 是否在给你带单"}
      </h1>
      
      {/* 副标题 - 解释具体价值 */}
      <p style={{ fontSize: 16, color: "#637381", marginBottom: 24, maxWidth: 500, margin: "0 auto 24px" }}>
        {en 
          ? "Find out if ChatGPT, Perplexity & AI assistants are sending you high-intent traffic — and what to optimize so they recommend you more." 
          : "发现 ChatGPT、Perplexity 等 AI 助手是否在推荐你的产品，以及如何让 AI 更容易推荐你。"}
      </p>
      
      {/* 3个核心价值点 */}
      <div style={{ 
        display: "flex", 
        gap: 16, 
        justifyContent: "center", 
        marginBottom: 24,
        flexWrap: "wrap",
      }}>
        <ValuePill 
          icon="🔍" 
          label={en ? "Detect AI Orders" : "识别 AI 订单"} 
          sublabel={en ? "Automatic attribution" : "自动归因"} 
        />
        <ValuePill 
          icon="📊" 
          label={en ? "Compare Conversion" : "对比转化率"} 
          sublabel={en ? "AI vs Other traffic" : "AI vs 其他流量"} 
        />
        <ValuePill 
          icon="🚀" 
          label={en ? "Get AI-Ready" : "AI 优化建议"} 
          sublabel={en ? "One-click fixes" : "一键落地"} 
        />
      </div>
      
      <Card padding="loose">
        {snapshot.hasData ? (
          <div style={{ background: "#f9fafb", borderRadius: 8, padding: 24 }}>
            {/* 数据预览标签 */}
            <div style={{ 
              display: "inline-block",
              background: "#e6f7ed", 
              color: "#2e7d32", 
              padding: "4px 12px", 
              borderRadius: 20, 
              fontSize: 12, 
              fontWeight: 500,
              marginBottom: 16,
            }}>
              {en ? "✓ AI orders detected in your store!" : "✓ 已检测到您店铺的 AI 订单！"}
            </div>
            
            <div style={{ fontSize: 12, color: "#919eab", marginBottom: 16 }}>
              {en ? "Last 30 Days Preview" : "最近 30 天预览"}
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
            
            {/* 行动号召 */}
            <p style={{ fontSize: 13, color: "#637381", marginTop: 16, marginBottom: 0 }}>
              {en 
                ? "🎯 Unlock full funnel analysis to see if AI traffic converts better." 
                : "🎯 解锁完整漏斗分析，查看 AI 流量是否转化更高。"}
            </p>
          </div>
        ) : (
          <div
            style={{
              background: "linear-gradient(135deg, #f0f7ff 0%, #e8f4fd 100%)",
              borderRadius: 8,
              padding: 32,
              border: "1px solid #91caff",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 48, marginBottom: 12 }}>🚀</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: "#0958d9", marginBottom: 8 }}>
              {en ? "Ready to Track AI Traffic" : "准备开始追踪 AI 流量"}
            </div>
            <div style={{ color: "#637381", fontSize: 14 }}>
              {en 
                ? "We'll start detecting AI orders as they come in. Results typically appear within 7 days."
                : "我们将自动检测 AI 订单。通常 7 天内即可看到结果。"}
            </div>
            
            {/* UTM 提示 */}
            <div style={{ 
              marginTop: 16, 
              padding: "12px 16px", 
              background: "#fffbe6", 
              border: "1px solid #ffe58f",
              borderRadius: 6,
              fontSize: 13,
              color: "#614700",
            }}>
              <strong>💡 {en ? "Pro Tip:" : "提示："}</strong>{" "}
              {en 
                ? "Add UTM parameters to your links for better AI detection accuracy." 
                : "在链接中添加 UTM 参数可提高 AI 流量检测准确度。"}
            </div>
          </div>
        )}
      </Card>
      
      <div style={{ marginTop: 24 }}>
        <Link 
          to={nextUrl}
          data-action="onboarding-next-plan"
          aria-label={en ? "Start 7-Day Proof" : "开始 7 天验证"}
          style={{ 
            display: "inline-block",
            background: "#008060", 
            color: "#fff", 
            padding: "14px 32px", 
            borderRadius: 6, 
            fontSize: 16, 
            fontWeight: 600,
            textDecoration: "none",
            boxShadow: "0 2px 8px rgba(0,128,96,0.3)",
          }}
        >
          {en ? "Start 7-Day Proof →" : "开始 7 天验证 →"}
        </Link>
        <p style={{ fontSize: 12, color: "#919eab", marginTop: 12 }}>
          {en ? "Free to start • No credit card required" : "免费开始 • 无需信用卡"}
        </p>
      </div>
    </section>
  );
}

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
      padding: "8px 12px",
      background: highlight ? "#e6f7ed" : "transparent",
      borderRadius: 6,
    }}>
      <div style={{ fontSize: 11, color: "#637381", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, color: "#212b36" }}>{overall}</div>
      <div style={{ fontSize: 12, color: "#635bff", fontWeight: 600 }}>AI: {ai}</div>
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

/** 模糊化漏斗预览（用于吸引升级） */
function BlurredFunnelPreview({ en }: { en: boolean }) {
  return (
    <div style={{ 
      position: "relative",
      maxWidth: 700, 
      margin: "0 auto 24px",
      padding: "20px 24px",
      background: "#f9fafb",
      borderRadius: 12,
      border: "1px dashed #c4cdd5",
    }}>
      {/* 模糊化的漏斗数据 */}
      <div style={{ filter: "blur(4px)", pointerEvents: "none" }}>
        <div style={{ display: "flex", justifyContent: "space-around", marginBottom: 16 }}>
          <FunnelStage label={en ? "Visit" : "访问"} overall="12.4K" ai="1.2K" />
          <span style={{ color: "#c4cdd5", fontSize: 24, alignSelf: "center" }}>→</span>
          <FunnelStage label={en ? "Cart" : "加购"} overall="3.1K" ai="380" />
          <span style={{ color: "#c4cdd5", fontSize: 24, alignSelf: "center" }}>→</span>
          <FunnelStage label={en ? "Checkout" : "结账"} overall="1.2K" ai="190" />
          <span style={{ color: "#c4cdd5", fontSize: 24, alignSelf: "center" }}>→</span>
          <FunnelStage label={en ? "Order" : "订单"} overall="680" ai="142" highlight />
        </div>
        <div style={{ display: "flex", justifyContent: "space-around" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: "#635bff" }}>4.2%</div>
            <div style={{ fontSize: 12, color: "#637381" }}>{en ? "Overall CVR" : "全站转化率"}</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: "#52c41a" }}>11.8%</div>
            <div style={{ fontSize: 12, color: "#637381" }}>{en ? "AI CVR" : "AI 转化率"}</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: "#fa8c16" }}>+181%</div>
            <div style={{ fontSize: 12, color: "#637381" }}>{en ? "AI Uplift" : "AI 提升"}</div>
          </div>
        </div>
      </div>
      
      {/* 覆盖层提示 */}
      <div style={{ 
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(255,255,255,0.7)",
        borderRadius: 12,
      }}>
        <div style={{ 
          fontSize: 32, 
          marginBottom: 8,
        }}>🔒</div>
        <div style={{ 
          fontSize: 16, 
          fontWeight: 600, 
          color: "#212b36",
          marginBottom: 4,
        }}>
          {en ? "Funnel Analysis" : "漏斗分析"}
        </div>
        <div style={{ 
          fontSize: 13, 
          color: "#637381",
          marginBottom: 12,
          textAlign: "center",
          maxWidth: 300,
        }}>
          {en 
            ? "Upgrade to Pro to see if AI traffic converts better than other channels" 
            : "升级到 Pro 版查看 AI 流量是否比其他渠道转化更高"}
        </div>
        <span style={{ 
          background: "#008060", 
          color: "#fff", 
          padding: "6px 16px", 
          borderRadius: 4,
          fontSize: 13,
          fontWeight: 500,
        }}>
          {en ? "Unlock with Pro" : "Pro 版解锁"}
        </span>
      </div>
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
    <section style={{ maxWidth: 1000, margin: "40px auto", padding: 20 }}>
      <h2 style={{ textAlign: "center", marginBottom: 8, color: "#212b36", fontSize: 28 }}>
        {en ? "Choose Your Plan" : "选择适合您的计划"}
      </h2>
      <p style={{ textAlign: "center", marginBottom: 24, color: "#637381", fontSize: 15 }}>
        {en 
          ? "Not just track AI traffic — prove ROI and optimize for more AI referrals" 
          : "不只追踪 AI 流量 — 证明 ROI 并优化以获得更多 AI 推荐"}
      </p>
      
      {/* 模糊化漏斗预览 - 吸引用户升级 */}
      <BlurredFunnelPreview en={en} />
      
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
