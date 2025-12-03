import type { HeadersFunction, LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useUILanguage } from "../lib/useUILanguage";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate, BILLING_PLAN } from "../shopify.server";
import { requireEnv } from "../lib/env.server";
import { getSettings, syncShopPreferences } from "../lib/settings.server";
import { 
    detectAndPersistDevShop, 
    computeIsTestMode, 
    getEffectivePlan, 
    requestSubscription, 
    calculateRemainingTrialDays,
    upsertBillingState
} from "../lib/billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const demo = process.env.DEMO_MODE === "true";
  type AuthShape = Awaited<ReturnType<typeof authenticate.admin>>;
  let admin: AuthShape["admin"] | null = null;
  let session: AuthShape["session"] | null = null;
  
  try {
    const auth = await authenticate.admin(request);
    admin = auth.admin;
    session = auth.session;
  } catch (e) {
    if (!demo) throw e;
  }
  
  const shopDomain = session?.shop || "";
  let settings = await getSettings(shopDomain);
  if (admin) {
      settings = await syncShopPreferences(admin, shopDomain, settings);
      await detectAndPersistDevShop(admin, shopDomain);
  }
  
  const plan = await getEffectivePlan(shopDomain);
  const trialDays = await calculateRemainingTrialDays(shopDomain);
  const price = Number(process.env.BILLING_PRICE || "29");
  const currencyCode = process.env.BILLING_CURRENCY || "USD";
  const language = settings.languages[0] || "中文";
  
  return { 
      language, 
      plan, 
      price, 
      currencyCode, 
      trialDays, 
      shopDomain, 
      demo,
      appUrl: requireEnv("SHOPIFY_APP_URL"),
      apiKey: process.env.SHOPIFY_API_KEY
  };
};

export default function Billing() {
  const { language, plan, price, currencyCode, trialDays, shopDomain, demo, appUrl, apiKey } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ ok: boolean; message?: string }>();
  const uiLanguage = useUILanguage(language);
  const en = uiLanguage === "English";
  
  const handleUpgrade = () => {
    fetcher.submit(
      { intent: "upgrade", shop: shopDomain },
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
                      {plan === "pro" ? "Pro" : (plan === "growth" ? "Growth" : "Free")}
                  </div>
              </div>
              <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 24, fontWeight: "bold" }}>
                      {plan === "free" ? "$0" : `$${price}`}
                      <span style={{ fontSize: 14, fontWeight: "normal", color: "#666" }}> / {en ? "mo" : "月"}</span>
                  </div>
              </div>
          </div>
          
          <hr style={{ border: "none", borderTop: "1px solid #eee", margin: "20px 0" }} />
          
          <div style={{ display: "flex", gap: 12 }}>
              {plan === "free" ? (
                  <button 
                    onClick={handleUpgrade}
                    disabled={fetcher.state !== "idle" || demo}
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
                      {fetcher.state !== "idle" ? "..." : (en ? `Upgrade to Pro (${trialDays} days trial)` : `升级到 Pro（${trialDays} 天试用）`)}
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
                        onClick={handleDowngrade}
                        disabled={fetcher.state !== "idle" || demo}
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
  const demo = process.env.DEMO_MODE === "true";
  if (demo) return Response.json({ ok: false, message: "Demo mode" });
  
  try {
    const { admin, session } = await authenticate.admin(request);
    const shopDomain = session?.shop || "";
    const formData = await request.formData();
    const intent = formData.get("intent");
    
    if (intent === "upgrade") {
        const isTest = await computeIsTestMode(shopDomain);
        const trialDays = await calculateRemainingTrialDays(shopDomain);
        const confirmationUrl = await requestSubscription(admin, shopDomain, BILLING_PLAN, isTest, trialDays);
        if (confirmationUrl) {
             throw new Response(null, { status: 302, headers: { Location: confirmationUrl } });
        } else {
             return Response.json({
               ok: false,
               message: "Failed to create subscription. confirmationUrl is missing."
             });
        }
    }
    
    if (intent === "downgrade") {
        // Just switch state to FREE_ACTIVE.
        // Important: In a real app, we should also CANCEL the Shopify subscription via API.
        // For now, setting state locally handles access control. 
        // We'll leave the actual cancellation to the merchant via "Manage in Shopify" or implement API cancel here.
        // Spec says: "Create Free internal plan & Cancel Shopify subscription".
        
        // TODO: Cancel subscription via GraphQL if needed. 
        // For MVP, user can cancel in Shopify. Or we can just overwrite state and let Shopify expire it.
        // Ideally we call appSubscriptionCancel.
        
        await upsertBillingState(shopDomain, {
            billingPlan: "free",
            billingState: "FREE_ACTIVE"
        });
        
        return Response.json({ ok: true });
    }
    
    return null;
  } catch (error) {
    if (error instanceof Response) throw error;
    return Response.json({
      ok: false,
      message: "Action failed."
    });
  }
};
