import type { HeadersFunction, LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useSearchParams, useActionData, Form, Link } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { requireEnv } from "../lib/env.server";
import { 
  detectAndPersistDevShop, 
  activateFreePlan,
  getBillingState,
  syncSubscriptionFromShopify,
} from "../lib/billing.server";
import { getSettings, syncShopPreferences } from "../lib/settings.server";
import { useUILanguage } from "../lib/useUILanguage";
import { BILLING_PLANS, PRIMARY_BILLABLE_PLAN_ID, type PlanId } from "../lib/billing/plans";
import { isDemoMode } from "../lib/runtime.server";
import { OrdersRepository } from "../lib/repositories/orders.repository";
import { resolveDateRange } from "../lib/aiData";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  type AuthShape = Awaited<ReturnType<typeof authenticate.admin>>;
  let admin: AuthShape["admin"] | null = null;
  let session: AuthShape["session"] | null = null;
  let authFailed = false;
  
  try {
    const auth = await authenticate.admin(request);
    admin = auth.admin;
    session = auth.session;
  } catch (error) {
    authFailed = true;
    // In onboarding, we allow unauthorized access to show plan selection
    // But we mark authFailed to avoid using invalid admin client
  }
  
  if (!session) return { language: "中文", authorized: false };

  const shopDomain = session.shop;
  let settings = await getSettings(shopDomain);
  
  // Only use admin if authentication succeeded
  if (admin && !authFailed) {
    try {
      settings = await syncShopPreferences(admin, shopDomain, settings);
      await detectAndPersistDevShop(admin, shopDomain);
      // 托管定价模式：从 Shopify 同步订阅状态
      await syncSubscriptionFromShopify(admin, shopDomain);
    } catch (e) {
      // If these fail, continue with cached data
      console.warn("Admin operations failed in onboarding:", (e as Error).message);
    }
  }
  
  // 获取同步后的计费状态
  const billingState = await getBillingState(shopDomain);
  const isReinstall = billingState?.lastUninstalledAt != null && billingState?.lastReinstalledAt != null;
  
  // Check if subscription was cancelled/expired (user needs to choose a plan)
  const isSubscriptionExpired = billingState?.billingState === "EXPIRED_NO_SUBSCRIPTION";
  const wasSubscribed = billingState?.hasEverSubscribed || false;
  
  // 检查是否已有活跃订阅（托管定价模式下，用户可能已经在安装时选择了计划）
  const hasActiveSubscription = billingState?.billingState?.includes("ACTIVE") || 
                                 billingState?.billingState?.includes("TRIALING");
  
  // 获取 AI 订单数据预览（最近 30 天）
  let aiSnapshot = {
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
    console.warn("Failed to load AI snapshot for onboarding:", (e as Error).message);
  }
  
  return { 
    language: settings.languages[0] || "中文", 
    shopDomain, 
    authorized: true,
    plans: Object.values(BILLING_PLANS)
      .filter((plan) => plan.status === "live") // 只显示已上线的计划
      .map((plan) => ({
        ...plan,
      })),
    isReinstall,
    isSubscriptionExpired,
    wasSubscribed,
    hasActiveSubscription,
    currentPlan: billingState?.billingPlan || null,
    aiSnapshot,
  };
};

export default function Onboarding() {
  const { 
    language, 
    shopDomain, 
    authorized,
    plans,
    isReinstall,
    isSubscriptionExpired,
    wasSubscribed,
    hasActiveSubscription,
    currentPlan,
    aiSnapshot,
  } = useLoaderData<typeof loader>();
  
  const [searchParams] = useSearchParams();
  const step = searchParams.get("step") || "value_snapshot";
  const reason = searchParams.get("reason");
  
  const actionData = useActionData<typeof action>() as { ok?: boolean; message?: string } | undefined;
  const uiLanguage = useUILanguage(language);
  const en = uiLanguage === "English";
  
  if (!authorized) {
    return <div style={{padding: 20}}>Unauthorized. Please access via Shopify Admin.</div>;
  }
  
  // 托管定价模式：如果已有活跃订阅，直接进入应用
  // （Shopify 在安装时已处理订阅选择）
  
  // 打开 Shopify 应用订阅管理页面
  const openSubscriptionPage = () => {
    window.open(`https://${shopDomain}/admin/settings/apps`, "_top");
  };
  
  // 格式化货币
  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat(en ? "en-US" : "zh-CN", {
      style: "currency",
      currency: currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };
  
  // Render Step 2: Value Snapshot
  if (step === "value_snapshot") {
    const snapshot = aiSnapshot || { totalOrders: 0, totalGMV: 0, aiOrders: 0, aiGMV: 0, aiShare: 0, currency: "USD", hasData: false };
    
    return (
      <section style={{ maxWidth: 600, margin: "40px auto", padding: 20, textAlign: "center", fontFamily: "system-ui, sans-serif" }}>
        <h1 style={{ fontSize: 24, marginBottom: 16 }}>
          {en ? "Uncover Your Hidden AI Revenue" : "发现被隐藏的 AI 渠道收入"}
        </h1>
        <div style={{ background: "#f1f2f4", padding: 40, borderRadius: 8, marginBottom: 24 }}>
           <p style={{ fontSize: 16, color: "#555", marginBottom: 20 }}>
             {en 
               ? "We analyze your orders to tell you exactly how much GMV comes from ChatGPT, Perplexity, and others." 
               : "我们通过分析订单来源，告诉您究竟有多少销售额来自 ChatGPT、Perplexity 等 AI 渠道。"}
           </p>
           
           {/* AI 数据快照 */}
           {snapshot.hasData ? (
             <div style={{ background: "#fff", borderRadius: 8, padding: 24, boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}>
               <div style={{ fontSize: 12, color: "#888", marginBottom: 16 }}>
                 {en ? "Last 30 Days" : "最近 30 天"}
               </div>
               
               <div style={{ display: "flex", justifyContent: "space-around", gap: 16 }}>
                 {/* AI GMV */}
                 <div>
                   <div style={{ fontSize: 28, fontWeight: "bold", color: "#008060" }}>
                     {formatCurrency(snapshot.aiGMV, snapshot.currency)}
                   </div>
                   <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>
                     {en ? "AI Revenue" : "AI 渠道收入"}
                   </div>
                 </div>
                 
                 {/* AI Orders */}
                 <div>
                   <div style={{ fontSize: 28, fontWeight: "bold", color: "#635bff" }}>
                     {snapshot.aiOrders}
                   </div>
                   <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>
                     {en ? "AI Orders" : "AI 订单数"}
                   </div>
                 </div>
                 
                 {/* AI Share */}
                 <div>
                   <div style={{ fontSize: 28, fontWeight: "bold", color: "#00a2ff" }}>
                     {snapshot.aiShare.toFixed(1)}%
                   </div>
                   <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>
                     {en ? "AI Share" : "AI 占比"}
                   </div>
                 </div>
               </div>
               
               {/* 进度条 */}
               <div style={{ marginTop: 20, background: "#e1e3e5", borderRadius: 4, height: 8, overflow: "hidden" }}>
                 <div 
                   style={{ 
                     width: `${Math.min(snapshot.aiShare, 100)}%`, 
                     height: "100%", 
                     background: "linear-gradient(90deg, #008060, #00a2ff)",
                     borderRadius: 4,
                     transition: "width 0.5s ease"
                   }} 
                 />
               </div>
               <div style={{ fontSize: 12, color: "#888", marginTop: 8 }}>
                 {en 
                   ? `${snapshot.aiShare.toFixed(1)}% of total ${formatCurrency(snapshot.totalGMV, snapshot.currency)} GMV`
                   : `占总 GMV ${formatCurrency(snapshot.totalGMV, snapshot.currency)} 的 ${snapshot.aiShare.toFixed(1)}%`}
               </div>
             </div>
           ) : (
             <div style={{ background: "#fff", borderRadius: 8, padding: 24, border: "1px dashed #ccc" }}>
               <div style={{ fontSize: 48, marginBottom: 12 }}>🔍</div>
               <div style={{ color: "#666" }}>
                 {en 
                   ? "No order data yet. Complete setup to start tracking AI revenue."
                   : "暂无订单数据。完成设置后即可开始追踪 AI 渠道收入。"}
               </div>
             </div>
           )}
        </div>
        <Link 
          to={`?${(() => {
            const p = new URLSearchParams(searchParams);
            p.set("step", "plan_selection");
            return p.toString();
          })()}`}
          data-action="onboarding-next-plan"
          aria-label={en ? "Next: Choose a Plan" : "下一步：选择方案"}
          style={{ 
            background: "#008060", 
            color: "white", 
            border: "none", 
            padding: "12px 24px", 
            borderRadius: 4, 
            fontSize: 16, 
            cursor: "pointer",
            textDecoration: "none",
            display: "inline-block"
          }}
        >
          {en ? "Next: Choose a Plan" : "下一步：选择方案"}
        </Link>
      </section>
    );
  }

  // Render Step 3: Plan Selection
  // 托管定价模式：显示计划信息，但订阅通过 Shopify 处理
  return (
    <section style={{ maxWidth: 900, margin: "40px auto", padding: 20, fontFamily: "system-ui, sans-serif" }}>
      <h2 style={{ textAlign: "center", marginBottom: 30 }}>{en ? "Choose Your Plan" : "选择适合您的计划"}</h2>
      
      {/* 托管定价说明 */}
      <div style={{ 
        marginBottom: 24, 
        padding: 16, 
        background: "#f0f9ff", 
        border: "1px solid #bae6fd",
        borderRadius: 8, 
        textAlign: "center" 
      }}>
        <div style={{ color: "#0369a1" }}>
          {en 
            ? "Subscription is managed through Shopify. Click 'Start Free' to begin with the free plan, or manage your subscription in Shopify settings."
            : "订阅通过 Shopify 管理。点击「开始使用免费版」开始使用，或在 Shopify 设置中管理订阅。"}
        </div>
      </div>
      
      {/* Subscription expired/cancelled banner */}
      {isSubscriptionExpired && (
        <div style={{ 
          marginBottom: 20, 
          padding: 16, 
          background: "#fff2e8", 
          border: "1px solid #ffbb96",
          borderRadius: 8, 
          textAlign: "center" 
        }}>
          <div style={{ fontSize: 18, fontWeight: "bold", color: "#d4380d", marginBottom: 8 }}>
            {en ? "Your subscription has ended" : "您的订阅已结束"}
          </div>
          <div style={{ color: "#d4380d" }}>
            {wasSubscribed 
              ? (en 
                  ? "Your paid subscription has been cancelled. Start with the free plan or upgrade in Shopify settings."
                  : "您的付费订阅已取消。可以先使用免费版，或在 Shopify 设置中升级。")
              : (en 
                  ? "Your trial has ended. Start with the free plan or upgrade in Shopify settings."
                  : "您的试用期已结束。可以先使用免费版，或在 Shopify 设置中升级。")}
          </div>
        </div>
      )}
      
      {/* Reinstall banner */}
      {isReinstall && !isSubscriptionExpired && (
        <div style={{ 
          marginBottom: 20, 
          padding: 16, 
          background: "#e6f7ff", 
          border: "1px solid #91d5ff",
          borderRadius: 8, 
          textAlign: "center" 
        }}>
          <div style={{ fontSize: 18, fontWeight: "bold", color: "#0050b3", marginBottom: 8 }}>
            🎉 {en ? "Welcome back!" : "欢迎回来！"}
          </div>
        </div>
      )}
      
      {actionData && actionData.ok === false && (
        <div style={{ marginBottom: 20, padding: 12, background: "#fff2e8", color: "#d4380d", borderRadius: 4, textAlign: "center" }}>
          {actionData.message}
        </div>
      )}

      <div style={{ display: "flex", gap: 20, justifyContent: "center", flexWrap: "wrap" }}>
        {(plans ?? []).map((plan) => {
          const isFree = plan.id === 'free';
          const recommended = plan.id === PRIMARY_BILLABLE_PLAN_ID;
          const isCurrentPlan = currentPlan === plan.id;
          const disabled = plan.status !== 'live';
          const priceLabel = plan.priceUsd === 0 ? "$0" : `$${plan.priceUsd}`;
          
          // 按钮标签
          let buttonLabel: string;
          if (isCurrentPlan) {
            buttonLabel = en ? "Current Plan" : "当前计划";
          } else if (plan.status === 'coming_soon') {
            buttonLabel = en ? "Coming soon" : "敬请期待";
          } else if (isFree) {
            buttonLabel = en ? "Start Free" : "开始使用免费版";
          } else {
            buttonLabel = en ? "Upgrade in Shopify" : "在 Shopify 中升级";
          }

          return (
            <div
              key={plan.id}
              style={{
                flex: 1,
                minWidth: 280,
                maxWidth: 340,
                border: recommended ? "2px solid #008060" : isCurrentPlan ? "2px solid #5c6ac4" : "1px solid #e1e3e5",
                borderRadius: 8,
                padding: 24,
                display: "flex",
                flexDirection: "column",
                position: "relative",
                background: recommended ? "#fbfcfd" : "white",
                opacity: plan.status === "live" ? 1 : 0.8,
              }}
            >
              {recommended && !isCurrentPlan && (
                <div
                  style={{
                    position: "absolute",
                    top: -12,
                    left: "50%",
                    transform: "translateX(-50%)",
                    background: "#008060",
                    color: "white",
                    padding: "2px 10px",
                    borderRadius: 12,
                    fontSize: 12,
                    fontWeight: "bold",
                  }}
                >
                  {en ? "RECOMMENDED" : "推荐"}
                </div>
              )}
              {isCurrentPlan && (
                <div
                  style={{
                    position: "absolute",
                    top: -12,
                    left: "50%",
                    transform: "translateX(-50%)",
                    background: "#5c6ac4",
                    color: "white",
                    padding: "2px 10px",
                    borderRadius: 12,
                    fontSize: 12,
                    fontWeight: "bold",
                  }}
                >
                  {en ? "CURRENT" : "当前"}
                </div>
              )}
              {plan.status === "coming_soon" && (
                <div
                  style={{
                    position: "absolute",
                    top: 8,
                    right: 8,
                    background: "#faad14",
                    color: "white",
                    padding: "2px 8px",
                    borderRadius: 999,
                    fontSize: 12,
                  }}
                >
                  {en ? "Coming Soon" : "即将上线"}
                </div>
              )}
              <h3 style={{ margin: 0, fontSize: 18, color: "#333" }}>{plan.name}</h3>
              <div style={{ fontSize: 32, fontWeight: "bold", margin: "12px 0" }}>
                {priceLabel}
                {plan.priceUsd > 0 && (
                  <span style={{ fontSize: 14, fontWeight: "normal", color: "#666" }}>
                    &nbsp;/ {en ? "mo" : "月"}
                  </span>
                )}
              </div>
              <p style={{ color: "#666", minHeight: 40 }}>{en ? plan.includes[0].en : plan.includes[0].zh}</p>
              <ul style={{ listStyle: "none", padding: 0, margin: "20px 0", flex: 1, lineHeight: "1.6" }}>
                {plan.includes.map((feature, idx) => (
                  <li key={idx}>✓ {en ? feature.en : feature.zh}</li>
                ))}
              </ul>
              
              {/* Free 计划使用表单提交，付费计划跳转到 Shopify */}
              {isFree ? (
                <Form method="post" replace>
                  <input type="hidden" name="intent" value="select_free" />
                  <input type="hidden" name="shop" value={shopDomain} />
                  <button
                    type="submit"
                    disabled={disabled || isCurrentPlan}
                    data-action="onboarding-select-plan"
                    data-plan-id={plan.id}
                    aria-label={buttonLabel}
                    style={{
                      width: "100%",
                      padding: "12px",
                      background: isCurrentPlan ? "#f5f5f5" : "white",
                      color: isCurrentPlan ? "#999" : "#333",
                      border: "1px solid #babfc3",
                      borderRadius: 4,
                      cursor: disabled || isCurrentPlan ? "not-allowed" : "pointer",
                      fontWeight: 600,
                    }}
                  >
                    {buttonLabel}
                  </button>
                </Form>
              ) : (
                <button
                  type="button"
                  onClick={openSubscriptionPage}
                  disabled={disabled || isCurrentPlan}
                  data-action="onboarding-select-plan"
                  data-plan-id={plan.id}
                  aria-label={buttonLabel}
                  style={{
                    width: "100%",
                    padding: "12px",
                    background: isCurrentPlan ? "#f5f5f5" : "#008060",
                    color: isCurrentPlan ? "#999" : "white",
                    border: "none",
                    borderRadius: 4,
                    cursor: disabled || isCurrentPlan ? "not-allowed" : "pointer",
                    fontWeight: 600,
                    boxShadow: isCurrentPlan ? "none" : "0 2px 5px rgba(0,0,0,0.1)",
                  }}
                >
                  {buttonLabel}
                </button>
              )}
              
              {plan.trialSupported && !isCurrentPlan && (
                <div style={{ textAlign: "center", fontSize: 12, color: "#666", marginTop: 8 }}>
                  {en ? "Includes free trial" : "包含免费试用期"}
                </div>
              )}
            </div>
          );
        })}

      </div>
    </section>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const demo = isDemoMode();
  
  if (demo) {
    return Response.json({
      ok: false,
      message: "Demo mode: billing is disabled.",
    });
  }
  
  try {
    const { session } = await authenticate.admin(request);
    const shopDomain = session?.shop || "";
    const formData = await request.formData();
    const intent = formData.get("intent");
    
    // 托管定价模式：只处理 Free 计划的激活
    // 付费计划通过 Shopify 管理，不在代码中处理
    if (intent === "select_free") {
      await activateFreePlan(shopDomain);
      const appUrl = requireEnv("SHOPIFY_APP_URL");
      throw new Response(null, { status: 302, headers: { Location: `${appUrl}/app` } });
    }

    return null;
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error(error);
    return Response.json({
      ok: false,
      message: "Action failed. Please try again.",
    });
  }
};
