import type { HeadersFunction, LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate, BILLING_PLAN } from "../shopify.server";
import { requireEnv } from "../lib/env.server";
import { 
  computeIsTestMode, 
  detectAndPersistDevShop, 
  calculateRemainingTrialDays,
  upsertBillingState,
  getBillingState,
  requestSubscription
} from "../lib/billing.server";
import { getSettings, syncShopPreferences } from "../lib/settings.server";
import { useUILanguage } from "../lib/useUILanguage";

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
  if (admin) settings = await syncShopPreferences(admin, shopDomain, settings);
  
  // Ensure we have a billing state record
  const isDevShop = admin ? await detectAndPersistDevShop(admin, shopDomain) : false;
  const trialDays = await calculateRemainingTrialDays(shopDomain);
  const billingState = await getBillingState(shopDomain);
  
  // If already has a plan, redirect to dashboard? 
  // Maybe not here, user might want to see onboarding if explicitly requested or "subscription_inactive"
  
  const price = Number(process.env.BILLING_PRICE || "29");
  const enabled = process.env.ENABLE_BILLING === "true";
  const demo = process.env.DEMO_MODE === "true";
  
  return { 
    language: settings.languages[0] || "中文", 
    planName: BILLING_PLAN, 
    trialDays, 
    price, 
    isDevShop, 
    enabled, 
    shopDomain, 
    demo,
    billingStateStr: billingState?.billingState || "NO_PLAN",
    authorized: true
  };
};

export default function Onboarding() {
  const { 
    language, 
    planName, 
    trialDays, 
    price, 
    isDevShop, 
    enabled, 
    shopDomain, 
    demo, 
    authorized,
    billingStateStr
  } = useLoaderData<typeof loader>();
  
  const [searchParams, setSearchParams] = useSearchParams();
  const step = searchParams.get("step") || "value_snapshot";
  
  const fetcher = useFetcher<{ ok: boolean; message?: string }>();
  const uiLanguage = useUILanguage(language);
  const en = uiLanguage === "English";
  
  if (!authorized) {
    return <div style={{padding: 20}}>Unauthorized. Please access via Shopify Admin.</div>;
  }

  const handleSelectFree = () => {
    fetcher.submit(
      { intent: "select_free", shop: shopDomain },
      { method: "post" }
    );
  };

  const handleSelectPro = () => {
    fetcher.submit(
      { intent: "select_pro", shop: shopDomain },
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
        
        {/* FREE PLAN */}
        <div style={{ 
          flex: 1, 
          minWidth: 280, 
          maxWidth: 350, 
          border: "1px solid #e1e3e5", 
          borderRadius: 8, 
          padding: 24, 
          display: "flex", 
          flexDirection: "column" 
        }}>
          <h3 style={{ margin: 0, fontSize: 18, color: "#333" }}>Free</h3>
          <div style={{ fontSize: 32, fontWeight: "bold", margin: "12px 0" }}>$0 <span style={{ fontSize: 14, fontWeight: "normal", color: "#666" }}>/mo</span></div>
          <p style={{ color: "#666", minHeight: 40 }}>{en ? "Essential AI attribution for small stores." : "适合小型店铺的基础 AI 归因。"}</p>
          
          <ul style={{ listStyle: "none", padding: 0, margin: "20px 0", flex: 1, lineHeight: "1.6" }}>
            <li>✓ {en ? "AI Channel Detection" : "AI 渠道识别"}</li>
            <li>✓ {en ? "Basic Stats (Last 7 days)" : "基础统计（最近 7 天）"}</li>
            <li>✓ {en ? "Single User" : "单用户"}</li>
            <li style={{ color: "#999" }}>✗ {en ? "No LTV/Retention metrics" : "无 LTV/留存指标"}</li>
            <li style={{ color: "#999" }}>✗ {en ? "No Historical Data" : "无历史全量数据"}</li>
          </ul>

          <button 
            type="button"
            onClick={handleSelectFree}
            disabled={fetcher.state !== "idle"}
            style={{ 
              width: "100%", 
              padding: "12px", 
              background: "white", 
              border: "1px solid #babfc3", 
              borderRadius: 4, 
              cursor: "pointer",
              fontWeight: 600
            }}
          >
            {fetcher.state !== "idle" ? "..." : (en ? "Select Free" : "选择免费版")}
          </button>
        </div>

        {/* PRO PLAN */}
        <div style={{ 
          flex: 1, 
          minWidth: 280, 
          maxWidth: 350, 
          border: "2px solid #008060", 
          borderRadius: 8, 
          padding: 24, 
          display: "flex", 
          flexDirection: "column",
          position: "relative",
          background: "#fbfcfd"
        }}>
          <div style={{ 
            position: "absolute", 
            top: -12, 
            left: "50%", 
            transform: "translateX(-50%)", 
            background: "#008060", 
            color: "white", 
            padding: "2px 10px", 
            borderRadius: 12, 
            fontSize: 12, 
            fontWeight: "bold"
          }}>
            {en ? "RECOMMENDED" : "推荐"}
          </div>
          <h3 style={{ margin: 0, fontSize: 18, color: "#333" }}>Pro</h3>
          <div style={{ fontSize: 32, fontWeight: "bold", margin: "12px 0" }}>
            ${price} <span style={{ fontSize: 14, fontWeight: "normal", color: "#666" }}>/mo</span>
          </div>
          <p style={{ color: "#666", minHeight: 40 }}>{en ? "Full power of AI analytics & Copilot." : "完整的 AI 分析与 Copilot 助手。"}</p>
          
          <ul style={{ listStyle: "none", padding: 0, margin: "20px 0", flex: 1, lineHeight: "1.6" }}>
             <li>✓ {en ? "Full Historical Analysis" : "全量历史分析"}</li>
             <li>✓ {en ? "LTV / AOV / Retention" : "LTV / AOV / 复购率"}</li>
             <li>✓ {en ? "AI Copilot Q&A" : "Copilot 智能问答"}</li>
             <li>✓ {en ? "llms.txt Generator" : "llms.txt 生成器"}</li>
             <li>✓ <b>{en ? `${trialDays}-Day Free Trial` : `${trialDays} 天免费试用`}</b></li>
          </ul>

          <button 
            type="button"
            onClick={handleSelectPro}
            disabled={fetcher.state !== "idle"}
            style={{ 
              width: "100%", 
              padding: "12px", 
              background: "#008060", 
              color: "white", 
              border: "none", 
              borderRadius: 4, 
              cursor: "pointer",
              fontWeight: 600,
              boxShadow: "0 2px 5px rgba(0,0,0,0.1)"
            }}
          >
            {fetcher.state !== "idle" ? "..." : (en ? `Start ${trialDays}-Day Free Trial` : `开始 ${trialDays} 天免费试用`)}
          </button>
          <div style={{ textAlign: "center", fontSize: 12, color: "#666", marginTop: 8 }}>
            {en ? "Cancel anytime during trial." : "试用期内随时取消。"}
          </div>
        </div>
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
    
    if (intent === "select_free") {
        // Activate Free Plan
        await upsertBillingState(shopDomain, {
            billingPlan: "free",
            billingState: "FREE_ACTIVE",
            // If they are downgrading from paid, we might need to cancel subscription, 
            // but for onboarding flow (NO_PLAN), we just set state.
        });
        
        // Redirect to dashboard
        const appUrl = requireEnv("SHOPIFY_APP_URL");
        throw new Response(null, { status: 302, headers: { Location: `${appUrl}/app` } });
    }
    
    if (intent === "select_pro") {
        const isTest = await computeIsTestMode(shopDomain);
        const trialDays = await calculateRemainingTrialDays(shopDomain);
        
        const confirmationUrl = await requestSubscription(
            admin,
            shopDomain,
            BILLING_PLAN,
            isTest,
            trialDays
        );
        
        if (confirmationUrl) {
           throw new Response(null, { status: 302, headers: { Location: confirmationUrl } }); 
        } else {
           return Response.json({
             ok: false,
             message: "Failed to create subscription. confirmationUrl is missing."
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
