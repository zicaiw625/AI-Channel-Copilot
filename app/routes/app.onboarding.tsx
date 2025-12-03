import type { HeadersFunction, LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { requireEnv } from "../lib/env.server";
import { 
  computeIsTestMode, 
  detectAndPersistDevShop, 
  calculateRemainingTrialDays,
  requestSubscription,
  activateFreePlan,
} from "../lib/billing.server";
import { getSettings, syncShopPreferences } from "../lib/settings.server";
import { useUILanguage } from "../lib/useUILanguage";
import { BILLING_PLANS, PRIMARY_BILLABLE_PLAN_ID, type PlanId } from "../lib/billing/plans";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  type AuthShape = Awaited<ReturnType<typeof authenticate.admin>>;
  let admin: AuthShape["admin"] | null = null;
  let session: AuthShape["session"] | null = null;
  try {
    const auth = await authenticate.admin(request);
    admin = auth.admin;
    session = auth.session;
  } catch (error) {
    void error;
  }
  
  if (!session) return { language: "中文", authorized: false };

  const shopDomain = session.shop;
  let settings = await getSettings(shopDomain);
  if (admin) {
    settings = await syncShopPreferences(admin, shopDomain, settings);
    await detectAndPersistDevShop(admin, shopDomain);
  }
  const trialDaysEntries = await Promise.all(
    (Object.keys(BILLING_PLANS) as PlanId[]).map(async (planId) => {
      const plan = BILLING_PLANS[planId];
      const remaining = plan.trialSupported ? await calculateRemainingTrialDays(shopDomain, planId) : 0;
      return [planId, remaining] as const;
    }),
  );
  const trialDays = Object.fromEntries(trialDaysEntries) as Record<PlanId, number>;
  
  return { 
    language: settings.languages[0] || "中文", 
    shopDomain, 
    authorized: true,
    plans: Object.values(BILLING_PLANS).map((plan) => ({
      ...plan,
      remainingTrialDays: trialDays[plan.id] || 0,
    })),
  };
};

export default function Onboarding() {
  const { 
    language, 
    shopDomain, 
    authorized,
    plans
  } = useLoaderData<typeof loader>();
  
  const [searchParams, setSearchParams] = useSearchParams();
  const step = searchParams.get("step") || "value_snapshot";
  
  const fetcher = useFetcher<{ ok: boolean; message?: string }>();
  const uiLanguage = useUILanguage(language);
  const en = uiLanguage === "English";
  
  if (!authorized) {
    return <div style={{padding: 20}}>Unauthorized. Please access via Shopify Admin.</div>;
  }

  const handleSelectPlan = (planId: PlanId) => {
    fetcher.submit(
      { intent: "select_plan", planId, shop: shopDomain },
      { method: "post" }
    );
  };
  
  // Render Step 2: Value Snapshot
  if (step === "value_snapshot") {
    return (
      <section style={{ maxWidth: 600, margin: "40px auto", padding: 20, textAlign: "center", fontFamily: "system-ui, sans-serif" }}>
        <h1 style={{ fontSize: 24, marginBottom: 16 }}>
          {en ? "Uncover Your Hidden AI Revenue" : "发现被隐藏的 AI 渠道收入"}
        </h1>
        <div style={{ background: "#f1f2f4", padding: 40, borderRadius: 8, marginBottom: 24 }}>
           <p style={{ fontSize: 16, color: "#555" }}>
             {en 
               ? "We analyze your orders to tell you exactly how much GMV comes from ChatGPT, Perplexity, and others." 
               : "我们通过分析订单来源，告诉您究竟有多少销售额来自 ChatGPT、Perplexity 等 AI 渠道。"}
           </p>
           {/* Placeholder for chart */}
           <div style={{ marginTop: 20, height: 100, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", color: "#ccc", border: "1px dashed #ccc" }}>
             {en ? "Live AI Revenue Snapshot (Generating...)" : "实时 AI 收入快照 (生成中...)"}
           </div>
        </div>
        <button 
          onClick={() => setSearchParams({ step: "plan_selection" })}
          style={{ 
            background: "#008060", 
            color: "white", 
            border: "none", 
            padding: "12px 24px", 
            borderRadius: 4, 
            fontSize: 16, 
            cursor: "pointer" 
          }}
        >
          {en ? "Next: Choose a Plan" : "下一步：选择方案"}
        </button>
      </section>
    );
  }

  // Render Step 3: Plan Selection
  return (
    <section style={{ maxWidth: 900, margin: "40px auto", padding: 20, fontFamily: "system-ui, sans-serif" }}>
      <h2 style={{ textAlign: "center", marginBottom: 30 }}>{en ? "Choose Your Plan" : "选择适合您的计划"}</h2>
      
      {fetcher.data && !fetcher.data.ok && (
        <div style={{ marginBottom: 20, padding: 12, background: "#fff2e8", color: "#d4380d", borderRadius: 4, textAlign: "center" }}>
          {fetcher.data.message}
        </div>
      )}

      <div style={{ display: "flex", gap: 20, justifyContent: "center", flexWrap: "wrap" }}>
        {plans.map((plan) => {
          const isFree = plan.id === 'free';
          const recommended = plan.id === PRIMARY_BILLABLE_PLAN_ID;
          const disabled = plan.status !== 'live' || fetcher.state !== 'idle';
          const priceLabel = plan.priceUsd === 0 ? "$0" : `$${plan.priceUsd}`;
          const trialLabel = plan.trialSupported
            ? plan.remainingTrialDays > 0
              ? en
                ? `${plan.remainingTrialDays} days free`
                : `剩余 ${plan.remainingTrialDays} 天试用`
              : en
                ? "Trial exhausted"
                : "试用次数已用完"
            : en
              ? "No trial"
              : "无试用";
          const buttonLabel =
            plan.status === 'coming_soon'
              ? (en ? "Coming soon" : "敬请期待")
              : fetcher.state !== 'idle'
                ? "..."
                : en
                  ? `Choose ${plan.name}`
                  : `选择 ${plan.name}`;

          return (
            <div
              key={plan.id}
              style={{
                flex: 1,
                minWidth: 280,
                maxWidth: 340,
                border: recommended ? "2px solid #008060" : "1px solid #e1e3e5",
                borderRadius: 8,
                padding: 24,
                display: "flex",
                flexDirection: "column",
                position: "relative",
                background: recommended ? "#fbfcfd" : "white",
                opacity: plan.status === "live" ? 1 : 0.8,
              }}
            >
              {recommended && (
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
              <p style={{ color: "#666", minHeight: 40 }}>{plan.includes[0]}</p>
              <ul style={{ listStyle: "none", padding: 0, margin: "20px 0", flex: 1, lineHeight: "1.6" }}>
                {plan.includes.map((feature) => (
                  <li key={feature}>✓ {feature}</li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => handleSelectPlan(plan.id)}
                disabled={disabled}
                style={{
                  width: "100%",
                  padding: "12px",
                  background: isFree ? "white" : "#008060",
                  color: isFree ? "#333" : "white",
                  border: isFree ? "1px solid #babfc3" : "none",
                  borderRadius: 4,
                  cursor: disabled ? "not-allowed" : "pointer",
                  fontWeight: 600,
                  boxShadow: isFree ? "none" : "0 2px 5px rgba(0,0,0,0.1)",
                }}
              >
                {buttonLabel}
              </button>
              {plan.trialSupported && (
                <div style={{ textAlign: "center", fontSize: 12, color: "#666", marginTop: 8 }}>
                  {trialLabel}
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
  const demo = process.env.DEMO_MODE === "true";
  
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
        const planId = (formData.get("planId") as PlanId) || "free";
        const plan = BILLING_PLANS[planId];
        if (!plan) {
          return Response.json({ ok: false, message: "Unknown plan" }, { status: 400 });
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
          throw new Response(null, { status: 302, headers: { Location: confirmationUrl } });
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
    console.error(error);
    return Response.json({
      ok: false,
      message: "Action failed. Please try again.",
    });
  }
};
