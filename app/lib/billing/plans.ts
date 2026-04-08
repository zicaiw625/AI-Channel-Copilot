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
    name: "Starter",
    shopifyName: "AI Attribution Starter",
    priceUsd: 0,
    interval: BASE_INTERVAL,
    trialSupported: false,
    defaultTrialDays: 0,
    status: "live",
    includes: [
      { en: "🎯 7-day AI revenue proof", zh: "🎯 7 天 AI 收入验证" },
      { en: "📊 AI GMV & order overview", zh: "📊 AI GMV & 订单数概览" },
      { en: "🔗 UTM link generator", zh: "🔗 UTM 链接生成器" },
      { en: "⚠️ Limited: No funnel / evidence chain / export", zh: "⚠️ 限制：无漏斗 / 证据链 / 导出" },
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    shopifyName: "AI Attribution Pro",
    priceUsd: 29,
    interval: BASE_INTERVAL,
    trialSupported: true,
    defaultTrialDays: 14,
    status: "live",
    includes: [
      { en: "📊 Funnel comparison: AI vs Overall traffic", zh: "📊 漏斗对比：AI vs 全站流量" },
      { en: "🔍 Evidence chain for every AI order", zh: "🔍 每笔 AI 订单的证据链" },
      { en: "📈 90-day history + AOV / LTV / repurchase", zh: "📈 90 天历史 + AOV / LTV / 复购率" },
      { en: "📥 CSV export: orders / products / customers", zh: "📥 CSV 导出：订单 / 产品 / 客户" },
      { en: "🤖 Instant answers for data insights", zh: "🤖 即时洞察问答" },
      { en: "✅ Prove AI ROI with conversion data", zh: "✅ 用转化数据证明 AI ROI" },
    ],
  },
  growth: {
    id: "growth",
    name: "Visibility",
    shopifyName: "AI Visibility Growth",
    priceUsd: 79,
    interval: BASE_INTERVAL,
    trialSupported: true,
    defaultTrialDays: 14,
    status: "live",
    includes: [
      { en: "🚀 AI Visibility Suite (one-click fixes)", zh: "🚀 AI 可见性套件（一键优化）" },
      { en: "📝 llms.txt auto-generation & hosting", zh: "📝 llms.txt 自动生成与托管" },
      { en: "🏷️ Schema markup suggestions + one-click apply", zh: "🏷️ Schema 标记建议 + 一键应用" },
      { en: "❓ FAQ content recommendations", zh: "❓ FAQ 内容推荐" },
      { en: "🏪 Multi-store overview", zh: "🏪 多店铺汇总视图" },
      { en: "👥 Team member access", zh: "👥 团队成员权限" },
      { en: "🔌 API & webhook export", zh: "🔌 API 与 Webhook 导出" },
      { en: "✨ All Pro features included", zh: "✨ 包含 Pro 所有功能" },
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

