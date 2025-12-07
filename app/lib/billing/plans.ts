export type PlanId = "free" | "pro" | "growth";

export type Interval = "EVERY_30_DAYS";

export type PlanConfig = {
  id: PlanId;
  name: string;
  shopifyName: string;
  priceUsd: number;
  interval: Interval;
  trialSupported: boolean;
  defaultTrialDays: number;
  includes: { en: string; zh: string }[];
  status: "live" | "coming_soon";
};

const BASE_INTERVAL: Interval = "EVERY_30_DAYS";

export const BILLING_PLANS: Record<PlanId, PlanConfig> = {
  free: {
    id: "free",
    name: "Free",
    shopifyName: "AI Copilot Free",
    priceUsd: 0,
    interval: BASE_INTERVAL,
    trialSupported: false,
    defaultTrialDays: 0,
    status: "live",
    includes: [
      { en: "Basic AI channel detection (last 7 days)", zh: "基础 AI 渠道识别（最近 7 天）" },
      { en: "AI GMV & order count overview", zh: "AI GMV & 订单数概览" },
      { en: "Limited: No evidence chain / funnel / export", zh: "限制：无证据链 / 漏斗 / 导出" },
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    shopifyName: "AI Copilot Pro",
    priceUsd: 29,
    interval: BASE_INTERVAL,
    trialSupported: true,
    defaultTrialDays: 14,
    status: "live",
    includes: [
      { en: "🔍 Why AI? Evidence chain for every order", zh: "🔍 证据链：每笔订单的归因解释" },
      { en: "📊 Full funnel: Visit → Cart → Checkout → Order", zh: "📊 完整漏斗：访问→加购→结账→订单" },
      { en: "📈 90-day history + AOV / LTV / repurchase", zh: "📈 90 天历史 + AOV / LTV / 复购率" },
      { en: "📥 CSV export: orders / products / customers", zh: "📥 CSV 导出：订单 / 产品 / 客户" },
      { en: "🤖 Copilot Q&A + llms.txt generator", zh: "🤖 Copilot 问答 + llms.txt 生成" },
      { en: "🚀 AI Optimization suggestions", zh: "🚀 AI 优化建议" },
    ],
  },
  growth: {
    id: "growth",
    name: "Growth",
    shopifyName: "AI Copilot Growth",
    priceUsd: 79,
    interval: BASE_INTERVAL,
    trialSupported: true,
    defaultTrialDays: 14,
    status: "coming_soon",
    includes: [
      { en: "Multi-store overview", zh: "多门店汇总视图" },
      { en: "Team member permissions", zh: "团队成员权限" },
      { en: "API export (Webhook / API)", zh: "协议化导出（Webhook / API）" },
      { en: "All Pro features included", zh: "包含 Pro 的所有功能" },
    ],
  },
};

export const PRIMARY_BILLABLE_PLAN_ID: PlanId = "pro";

export const getPlanConfig = (planId: PlanId): PlanConfig => BILLING_PLANS[planId];

export const getPaidPlans = () => Object.values(BILLING_PLANS).filter((plan) => plan.priceUsd > 0);

export const resolvePlanByShopifyName = (name?: string | null): PlanConfig | null => {
  if (!name) return null;
  const normalized = name.trim().toLowerCase();
  return Object.values(BILLING_PLANS).find((plan) => plan.shopifyName.toLowerCase() === normalized) || null;
};

/**
 * 验证并解析 planId
 * 防止用户传入恶意或无效的计划 ID
 * 
 * @param value - 需要验证的值
 * @returns 有效的 PlanId 或 null
 */
export const validatePlanId = (value: unknown): PlanId | null => {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase().trim();
  if (normalized === "free" || normalized === "pro" || normalized === "growth") {
    return normalized as PlanId;
  }
  return null;
};

/**
 * 验证 planId 并返回对应的配置
 * 如果无效则返回 null
 */
export const validateAndGetPlan = (value: unknown): PlanConfig | null => {
  const planId = validatePlanId(value);
  if (!planId) return null;
  return BILLING_PLANS[planId] || null;
};

