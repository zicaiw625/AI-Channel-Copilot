import { Form } from "react-router";
import { Banner, Button, Card, PlanCard } from "../ui";

interface PlanFeature {
  en: string;
  zh: string;
}

interface BillingPlan {
  id: string;
  name: string;
  priceUsd: number;
  trialSupported: boolean;
  includes: PlanFeature[];
  remainingTrialDays: number;
}

export function BillingFeedbackBanners({
  en,
  actionMessage,
  downgradeResult,
}: {
  en: boolean;
  actionMessage?: string;
  downgradeResult?: { ok?: boolean; message?: string };
}) {
  return (
    <>
      {actionMessage && (
        <div style={{ marginBottom: 20 }}>
          <Banner status="critical">{actionMessage}</Banner>
        </div>
      )}

      {downgradeResult && (
        <div style={{ marginBottom: 20 }}>
          <Banner status={downgradeResult.ok ? "success" : "critical"}>
            {downgradeResult.ok
              ? downgradeResult.message || (en ? "Successfully downgraded to Free plan." : "已成功降级到免费版。")
              : downgradeResult.message || (en ? "Downgrade failed. Please try again." : "降级失败，请重试。")}
          </Banner>
        </div>
      )}
    </>
  );
}

export function BillingIntro({ en }: { en: boolean }) {
  return (
    <div style={{ marginBottom: 20, color: "#637381", fontSize: 14, lineHeight: 1.6 }}>
      {en
        ? "Use this page to review your current plan, trial status, and switching options. Onboarding focuses on getting started; Billing is where you manage plan changes."
        : "这里用于查看当前方案、试用状态和切换选项。Onboarding 负责帮助你开始使用，Billing 负责后续方案管理。"}
    </div>
  );
}

export function BillingCurrentPlanCard({
  en,
  hasNoPlan,
  activePlan,
  activePlanId,
  priceLabel,
  showTrialBanner,
  formattedTrialEndDate,
  trialPlanName,
  demo,
  shopDomain,
  primaryPlanName,
  primaryPlanId,
  onOpenShopifyAppSettings,
  onRequestDowngrade,
}: {
  en: boolean;
  hasNoPlan: boolean;
  activePlan: BillingPlan;
  activePlanId: string;
  priceLabel: string;
  showTrialBanner: boolean;
  formattedTrialEndDate: string | null;
  trialPlanName: string;
  demo: boolean;
  shopDomain: string;
  primaryPlanName: string;
  primaryPlanId: string;
  onOpenShopifyAppSettings: () => void;
  onRequestDowngrade: () => void;
}) {
  const trialBannerStyle =
    activePlanId === "growth"
      ? { background: "#f6ffed", border: "1px solid #b7eb8f", color: "#389e0d" }
      : { background: "#f4f5fa", border: "1px solid #e1e3e5", color: "#5c6ac4" };

  return (
    <Card padding="tight">
      {hasNoPlan ? (
        <div style={{ textAlign: "center", padding: "20px 0" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🎯</div>
          <div style={{ fontSize: 18, fontWeight: "bold", marginBottom: 8 }}>
            {en ? "Plan setup pending" : "尚未完成方案设置"}
          </div>
          <div style={{ color: "#666", marginBottom: 20 }}>
            {en
              ? "Choose a plan below to unlock the level of reporting and optimization support you need."
              : "请从下方选择一个方案，以解锁你当前需要的数据分析与优化能力。"}
          </div>
          <a href="#plans" style={{ textDecoration: "none" }}>
            <Button variant="primary" size="large">
              {en ? "Choose a Plan" : "选择计划"}
            </Button>
          </a>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 14, color: "#666", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                {en ? "Current Plan" : "当前计划"}
              </div>
              <div style={{ fontSize: 24, fontWeight: "bold", marginTop: 4 }}>{activePlan.name}</div>
              <div style={{ marginTop: 6, color: "#637381", fontSize: 13 }}>
                {en
                  ? "Review your active plan, then switch or manage the subscription if your reporting needs change."
                  : "在这里查看当前生效方案；如果你的分析或优化需求发生变化，可在此切换或管理订阅。"}
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
            <div style={{ marginBottom: 16, padding: 12, borderRadius: 8, ...trialBannerStyle }}>
              <div style={{ fontWeight: 500 }}>
                ✨ {en
                  ? `Enjoying your ${trialPlanName} trial · ${activePlan.remainingTrialDays} day${activePlan.remainingTrialDays === 1 ? "" : "s"} remaining`
                  : `正在体验 ${trialPlanName} 全部功能 · 剩余 ${activePlan.remainingTrialDays} 天`}
              </div>
              {formattedTrialEndDate && (
                <div style={{ fontSize: 12, marginTop: 4, color: "#637381" }}>
                  {en ? `Your subscription continues on ${formattedTrialEndDate}` : `订阅将于 ${formattedTrialEndDate} 正式生效`}
                </div>
              )}
            </div>
          )}

          <hr style={{ border: "none", borderTop: "1px solid #eee", margin: "20px 0" }} />

          <div style={{ display: "flex", gap: 12 }}>
            {activePlanId === "free" ? (
              <Form method="post" replace>
                <input type="hidden" name="intent" value="upgrade" />
                <input type="hidden" name="planId" value={primaryPlanId} />
                <input type="hidden" name="shop" value={shopDomain} />
                <Button
                  type="submit"
                  disabled={demo}
                  data-action="billing-upgrade"
                  aria-label={en ? `Upgrade to ${primaryPlanName}` : `升级到 ${primaryPlanName}`}
                  variant="primary"
                  size="medium"
                >
                  {en ? `Upgrade to ${primaryPlanName}` : `升级到 ${primaryPlanName}`}
                </Button>
              </Form>
            ) : (
              <>
                <Button type="button" onClick={onOpenShopifyAppSettings} variant="secondary" size="medium">
                  {en ? "Manage in Shopify" : "在 Shopify 中管理"}
                </Button>

                <Button
                  type="button"
                  onClick={onRequestDowngrade}
                  disabled={demo}
                  data-action="billing-downgrade"
                  aria-label={en ? "Downgrade to Free" : "降级到免费版"}
                  variant="plain"
                  size="medium"
                  style={{ color: "#d4380d" }}
                >
                  {en ? "Downgrade to Free" : "降级到免费版"}
                </Button>
              </>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

function BillingPlanAction({
  en,
  plan,
  isActive,
  hasNoPlan,
  demo,
  shopDomain,
  onRequestDowngrade,
}: {
  en: boolean;
  plan: BillingPlan;
  isActive: boolean;
  hasNoPlan: boolean;
  demo: boolean;
  shopDomain: string;
  onRequestDowngrade: () => void;
}) {
  if (plan.id === "free") {
    if (hasNoPlan) {
      return (
        <Form method="post" replace>
          <input type="hidden" name="intent" value="select_free" />
          <input type="hidden" name="shop" value={shopDomain} />
          <Button
            type="submit"
            disabled={demo}
            fullWidth
            data-action="billing-select-plan"
            data-plan-id={plan.id}
            aria-label={en ? "Choose Free" : "选择 Free"}
            variant="secondary"
          >
            {en ? "Choose Free" : "选择 Free"}
          </Button>
        </Form>
      );
    }

    return (
      <Button
        type="button"
        onClick={onRequestDowngrade}
        disabled={demo || isActive}
        fullWidth
        data-action="billing-select-plan"
        data-plan-id={plan.id}
        aria-label={isActive ? (en ? "Current Plan" : "当前方案") : en ? "Switch to Free" : "切换到免费版"}
        variant="secondary"
      >
        {isActive ? (en ? "Current Plan" : "当前方案") : (en ? "Switch to Free" : "切换到免费版")}
      </Button>
    );
  }

  return (
    <Form method="post" replace>
      <input type="hidden" name="intent" value="upgrade" />
      <input type="hidden" name="planId" value={plan.id} />
      <input type="hidden" name="shop" value={shopDomain} />
      <Button
        type="submit"
        disabled={demo || isActive}
        fullWidth
        data-action="billing-select-plan"
        data-plan-id={plan.id}
        aria-label={isActive ? (en ? "Current Plan" : "当前方案") : en ? `Switch to ${plan.name}` : `切换到 ${plan.name}`}
        variant="primary"
      >
        {isActive ? (en ? "Current Plan" : "当前方案") : (en ? `Switch to ${plan.name}` : `切换到 ${plan.name}`)}
      </Button>
    </Form>
  );
}

export function BillingPlansSection({
  en,
  plans,
  activePlanId,
  hasNoPlan,
  demo,
  shopDomain,
  onRequestDowngrade,
}: {
  en: boolean;
  plans: BillingPlan[];
  activePlanId: string;
  hasNoPlan: boolean;
  demo: boolean;
  shopDomain: string;
  onRequestDowngrade: () => void;
}) {
  return (
    <div id="plans" style={{ marginTop: 32 }}>
      <h3 style={{ marginBottom: 16 }}>{en ? "Available Plans" : "可用方案"}</h3>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        {plans.map((plan) => {
          const isActive = !hasNoPlan && plan.id === activePlanId;
          const priceLabel = plan.priceUsd === 0 ? "$0" : `$${plan.priceUsd}`;
          const trialLabel = plan.trialSupported ? (en ? "Includes free trial" : "包含免费试用") : (en ? "No trial" : "无试用");

          return (
            <PlanCard
              key={plan.id}
              name={plan.name}
              price={priceLabel}
              period={plan.priceUsd > 0 ? (en ? "mo" : "月") : undefined}
              description={trialLabel}
              features={plan.includes.slice(0, 3).map((feature) => (en ? feature.en : feature.zh))}
              recommended={plan.id === activePlanId}
              buttonLabel={isActive ? (en ? "Current Plan" : "当前方案") : (en ? `Switch to ${plan.name}` : `切换到 ${plan.name}`)}
              disabled={demo || isActive}
              en={en}
            >
              <BillingPlanAction
                en={en}
                plan={plan}
                isActive={isActive}
                hasNoPlan={hasNoPlan}
                demo={demo}
                shopDomain={shopDomain}
                onRequestDowngrade={onRequestDowngrade}
              />
            </PlanCard>
          );
        })}
      </div>
    </div>
  );
}

export function BillingDemoBanner({ en, demo }: { en: boolean; demo: boolean }) {
  if (!demo) return null;

  return (
    <div style={{ marginTop: 20 }}>
      <Banner status="info">{en ? "Demo mode: Billing actions disabled." : "Demo 模式：计费操作已禁用。"}</Banner>
    </div>
  );
}

export function DowngradeConfirmationModal({
  en,
  open,
  onCancel,
  onConfirm,
}: {
  en: boolean;
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: "white",
          borderRadius: 12,
          padding: 24,
          maxWidth: 420,
          width: "90%",
          boxShadow: "0 4px 24px rgba(0, 0, 0, 0.15)",
        }}
      >
        <h3 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 600 }}>{en ? "Confirm Downgrade" : "确认降级"}</h3>
        <p style={{ margin: "0 0 20px", color: "#555", lineHeight: 1.5 }}>
          {en
            ? "Are you sure you want to downgrade to Free? You will lose access to detailed history and Copilot."
            : "确定要降级到免费版吗？您将失去历史数据详情和 Copilot 功能。"}
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
          <Button type="button" onClick={onCancel} variant="secondary">
            {en ? "Cancel" : "取消"}
          </Button>
          <Button type="button" onClick={onConfirm} variant="destructive">
            {en ? "Downgrade" : "确认降级"}
          </Button>
        </div>
      </div>
    </div>
  );
}
