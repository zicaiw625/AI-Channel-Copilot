import type { CSSProperties } from "react";
import { Form } from "react-router";
import { Banner, Button, PlanCard } from "../ui";

interface AISnapshot {
  totalOrders: number;
  totalGMV: number;
  aiOrders: number;
  aiGMV: number;
  aiShare: number;
  currency: string;
  hasData: boolean;
}

interface PlanFeature {
  en: string;
  zh: string;
}

interface PlanWithTrial {
  id: string;
  name: string;
  priceUsd: number;
  trialSupported: boolean;
  includes: PlanFeature[];
  status: "live" | "coming_soon";
  remainingTrialDays: number;
}

function ValuePill({ icon, label, sublabel }: { icon: string; label: string; sublabel: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "12px 16px",
        background: "#f9fafb",
        borderRadius: 8,
        minWidth: 120,
      }}
    >
      <span style={{ fontSize: 24, marginBottom: 4 }}>{icon}</span>
      <span style={{ fontSize: 14, fontWeight: 600, color: "#212b36" }}>{label}</span>
      <span style={{ fontSize: 11, color: "#919eab" }}>{sublabel}</span>
    </div>
  );
}

function FunnelStage({
  label,
  overall,
  ai,
  highlight = false,
}: {
  label: string;
  overall: string;
  ai: string;
  highlight?: boolean;
}) {
  return (
    <div
      style={{
        textAlign: "center",
        padding: "6px 10px",
        background: highlight ? "#e6f7ed" : "transparent",
        borderRadius: 6,
      }}
    >
      <div style={{ fontSize: 10, color: "#637381", marginBottom: 1 }}>{label}</div>
      <div style={{ fontSize: 12, color: "#212b36" }}>{overall}</div>
      <div style={{ fontSize: 11, color: "#635bff", fontWeight: 600 }}>AI: {ai}</div>
    </div>
  );
}

function FeatureChip({ icon, label }: { icon: string; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#333" }}>
      <span>{icon}</span>
      <span>{label}</span>
    </div>
  );
}

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
        <span
          style={{
            fontSize: 16,
            color: "#0958d9",
            fontWeight: 700,
            display: "block",
            marginBottom: 4,
          }}
        >
          {en ? "🎯 Understand AI traffic quality with funnel comparison" : "🎯 通过漏斗对比理解 AI 流量质量"}
        </span>
        <span style={{ fontSize: 13, color: "#637381" }}>
          {en ? "Visit → Add to Cart → Checkout → Order — Compare AI vs Overall" : "访问 → 加购 → 发起结账 → 成交 — AI 渠道 vs 全站对比"}
        </span>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          marginBottom: 16,
          padding: "12px 16px",
          background: "rgba(255,255,255,0.8)",
          borderRadius: 8,
        }}
      >
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
        {en ? "Pro: Compare AI conversion quality with real checkout and order data" : "Pro 版：用真实结账与订单数据对比 AI 流量转化质量"}
      </div>
    </div>
  );
}

function ScorePreview({ label, score, color }: { label: string; score: number; color: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: "50%",
          background: `conic-gradient(${color} ${score}%, #e8e8e8 0)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "0 auto 6px",
        }}
      >
        <div
          style={{
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
          }}
        >
          {score}
        </div>
      </div>
      <div style={{ fontSize: 11, color: "#637381" }}>{label}</div>
    </div>
  );
}

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
        <span
          style={{
            fontSize: 16,
            color: "#389e0d",
            fontWeight: 700,
            display: "block",
            marginBottom: 4,
          }}
        >
          {en ? "🚀 Make your store easier for AI assistants to understand" : "🚀 让你的店铺更容易被 AI 助手理解"}
        </span>
        <span style={{ fontSize: 13, color: "#637381" }}>
          {en ? "One-click fixes: llms.txt + Schema + FAQ — Your AI SEO workspace" : "一键落地：llms.txt + Schema + FAQ — 你的 AI SEO 工作台"}
        </span>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 24,
          marginBottom: 16,
          padding: "16px 20px",
          background: "rgba(255,255,255,0.9)",
          borderRadius: 8,
        }}
      >
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
        {en ? "Growth: move from tracking AI traffic to improving AI visibility" : "Growth 版：从追踪 AI 流量，走向持续提升 AI 可见性"}
      </div>
    </div>
  );
}

function OnboardingPlanButton({
  en,
  planId,
  planName,
  shopDomain,
  disabled,
  buttonLabel,
  variant,
  style,
}: {
  en: boolean;
  planId: string;
  planName: string;
  shopDomain: string;
  disabled: boolean;
  buttonLabel: string;
  variant: "primary" | "secondary";
  style?: CSSProperties;
}) {
  return (
    <Form method="post" replace>
      <input type="hidden" name="intent" value="select_plan" />
      <input type="hidden" name="planId" value={planId} />
      <input type="hidden" name="shop" value={shopDomain} />
      <Button
        type="submit"
        disabled={disabled}
        fullWidth
        variant={variant}
        size="large"
        style={style}
        aria-label={disabled ? (en ? "Disabled" : "不可用") : en ? `Choose ${planName}` : `选择 ${planName}`}
      >
        {buttonLabel}
      </Button>
    </Form>
  );
}

function GrowthPlanCard({
  plan,
  en,
  shopDomain,
  trialLabel,
  buttonLabel,
}: {
  plan: PlanWithTrial;
  en: boolean;
  shopDomain: string;
  trialLabel?: string;
  buttonLabel: string;
}) {
  const disabled = plan.status !== "live";
  const priceLabel = plan.priceUsd === 0 ? "$0" : `$${plan.priceUsd}`;

  return (
    <div
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
          <p style={{ color: "#637381", margin: "8px 0 0" }}>{en ? plan.includes[0].en : plan.includes[0].zh}</p>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 28, fontWeight: "bold" }}>
            {priceLabel}
            <span style={{ fontSize: 14, fontWeight: "normal", color: "#637381" }}>&nbsp;/ {en ? "mo" : "月"}</span>
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
        {plan.includes.map((feature, idx) => (
          <li key={idx}>✓ {en ? feature.en : feature.zh}</li>
        ))}
      </ul>

      <OnboardingPlanButton
        en={en}
        planId={plan.id}
        planName={plan.name}
        shopDomain={shopDomain}
        disabled={disabled}
        buttonLabel={buttonLabel}
        variant="primary"
        style={{ background: "#389e0d" }}
      />

      {trialLabel && (
        <div style={{ textAlign: "center", fontSize: 12, color: "#637381", marginTop: 8 }}>
          {trialLabel}
        </div>
      )}
    </div>
  );
}

export function OnboardingHero({
  en,
  snapshot,
  formatCurrency,
}: {
  en: boolean;
  snapshot: AISnapshot;
  formatCurrency: (amount: number, currency: string) => string;
}) {
  return (
    <div style={{ textAlign: "center", marginBottom: 32 }}>
      <h1 style={{ fontSize: 28, marginBottom: 12, color: "#212b36", lineHeight: 1.3 }}>
        {en ? "Start measuring AI-attributed revenue in your first week" : "在首周开始观察 AI 渠道带来的收入线索"}
      </h1>
      <p style={{ fontSize: 16, color: "#637381", maxWidth: 600, margin: "0 auto 20px" }}>
        {en
          ? "See whether ChatGPT, Perplexity, and other AI assistants are sending meaningful traffic, and decide what to improve next."
          : "观察 ChatGPT、Perplexity 等 AI 助手是否正在带来有价值的流量，并判断下一步该优化什么。"}
      </p>

      <div style={{ display: "flex", gap: 12, justifyContent: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <ValuePill icon="🔍" label={en ? "Detect AI Orders" : "识别 AI 订单"} sublabel={en ? "Revenue signals" : "收入线索"} />
        <ValuePill icon="📊" label={en ? "Compare Conversion" : "对比转化率"} sublabel={en ? "AI vs other traffic" : "AI vs 其他流量"} />
        <ValuePill icon="🚀" label={en ? "Improve AI Visibility" : "提升 AI 可见性"} sublabel={en ? "Actionable fixes" : "可执行修复"} />
      </div>

      {snapshot.hasData && (
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 16,
            background: "#f6ffed",
            border: "1px solid #b7eb8f",
            borderRadius: 24,
            padding: "8px 20px",
            fontSize: 14,
          }}
        >
          <span style={{ color: "#389e0d" }}>✓ {en ? "AI orders detected!" : "已检测到 AI 订单！"}</span>
          <span style={{ color: "#333" }}>
            <strong>{formatCurrency(snapshot.aiGMV, snapshot.currency)}</strong> AI GMV · <strong>{snapshot.aiOrders}</strong> {en ? "orders" : "订单"}
          </span>
        </div>
      )}
    </div>
  );
}

export function OnboardingStatusBanners({
  en,
  isSubscriptionExpired,
  wasSubscribed,
  reason,
  showReinstallTrialBanner,
  remainingTrialDays,
  actionMessage,
}: {
  en: boolean;
  isSubscriptionExpired: boolean;
  wasSubscribed: boolean;
  reason: string | null;
  showReinstallTrialBanner: boolean;
  remainingTrialDays: number;
  actionMessage?: string;
}) {
  return (
    <div style={{ maxWidth: 700, margin: "0 auto 20px", display: "flex", flexDirection: "column", gap: 12 }}>
      {isSubscriptionExpired && (
        <Banner status="warning" title={en ? "Your subscription has ended" : "您的订阅已结束"}>
          {wasSubscribed
            ? en
              ? "Your paid subscription has been cancelled. Choose a plan below to continue."
              : "您的付费订阅已取消。请选择一个计划以继续使用。"
            : en
              ? "Your trial has ended. Choose a plan below to continue."
              : "您的试用期已结束。请选择一个计划以继续使用。"}
        </Banner>
      )}

      {reason === "subscription_declined" && (
        <Banner status="critical" title={en ? "Subscription not completed" : "订阅未完成"}>
          {en ? "The subscription was not confirmed. Please try again or choose a different plan." : "订阅确认未完成。请重试或选择其他计划。"}
        </Banner>
      )}

      {showReinstallTrialBanner && !isSubscriptionExpired && (
        <Banner status="info" title={en ? "🎉 Welcome back!" : "🎉 欢迎回来！"}>
          {en ? `You still have ${remainingTrialDays} days of Pro trial remaining. Pick up where you left off!` : `您还有 ${remainingTrialDays} 天的 Pro 试用期。继续您的体验吧！`}
        </Banner>
      )}

      {actionMessage && <Banner status="critical">{actionMessage}</Banner>}
    </div>
  );
}

export function OnboardingPlanSelection({
  en,
  plans,
  shopDomain,
  recommendedPlanId,
}: {
  en: boolean;
  plans: PlanWithTrial[];
  shopDomain: string;
  recommendedPlanId: string;
}) {
  const freePlan = plans.find((plan) => plan.id === "free");
  const proPlan = plans.find((plan) => plan.id === "pro");
  const growthPlan = plans.find((plan) => plan.id === "growth");

  const renderPlanCard = (plan: PlanWithTrial) => {
    const isFree = plan.id === "free";
    const recommended = plan.id === recommendedPlanId;
    const disabled = plan.status !== "live";
    const priceLabel = plan.priceUsd === 0 ? "$0" : `$${plan.priceUsd}`;
    const trialLabel = plan.trialSupported
      ? plan.remainingTrialDays > 0
        ? en
          ? `${plan.remainingTrialDays} days free`
          : `剩余 ${plan.remainingTrialDays} 天试用`
        : en
          ? "Trial exhausted"
          : "试用次数已用完"
      : undefined;
    const buttonLabel = plan.status === "coming_soon" ? (en ? "Coming soon" : "敬请期待") : en ? `Choose ${plan.name}` : `选择 ${plan.name}`;

    return (
      <PlanCard
        key={plan.id}
        name={plan.name}
        price={priceLabel}
        period={plan.priceUsd > 0 ? (en ? "mo" : "月") : undefined}
        description={en ? plan.includes[0].en : plan.includes[0].zh}
        features={plan.includes.map((feature) => (en ? feature.en : feature.zh))}
        recommended={recommended}
        comingSoon={plan.status === "coming_soon"}
        disabled={disabled}
        trialLabel={trialLabel}
        buttonLabel={buttonLabel}
        en={en}
      >
        <OnboardingPlanButton
          en={en}
          planId={plan.id}
          planName={plan.name}
          shopDomain={shopDomain}
          disabled={disabled}
          buttonLabel={buttonLabel}
          variant={isFree ? "secondary" : "primary"}
        />
      </PlanCard>
    );
  };

  return (
    <>
      <h2 style={{ textAlign: "center", marginBottom: 8, color: "#212b36", fontSize: 22 }}>
        {en ? "Choose how you want to start" : "选择你的起步方式"}
      </h2>
      <p style={{ textAlign: "center", marginBottom: 20, color: "#637381", fontSize: 14 }}>
        {en
          ? "Use this page to get started quickly. You can manage billing details and future switches from the Billing page."
          : "这里帮助你快速开始使用；后续的计费管理和方案切换可在 Billing 页面完成。"}
      </p>

      <ProValueBanner en={en} />
      <GrowthValueBanner en={en} />

      <div style={{ display: "flex", gap: 20, justifyContent: "center", flexWrap: "wrap", marginBottom: 20 }}>
        {freePlan && renderPlanCard(freePlan)}
        {proPlan && renderPlanCard(proPlan)}
      </div>

      {growthPlan && (
        <GrowthPlanCard
          plan={growthPlan}
          en={en}
          shopDomain={shopDomain}
          trialLabel={
            growthPlan.trialSupported
              ? growthPlan.remainingTrialDays > 0
                ? en
                  ? `${growthPlan.remainingTrialDays} days free`
                  : `剩余 ${growthPlan.remainingTrialDays} 天试用`
                : en
                  ? "Trial exhausted"
                  : "试用次数已用完"
              : undefined
          }
          buttonLabel={en ? `Choose ${growthPlan.name}` : `选择 ${growthPlan.name}`}
        />
      )}
    </>
  );
}
