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
  includes: string[];
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
      "AI 渠道识别 & 基础统计（最近 7 天）",
      "单店铺 / 单用户",
      "不显示 LTV、复购率等深度指标",
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
      "全量历史 AI 订单 & GMV 分析",
      "AOV / 新客占比 / 退款率 / 基础 LTV",
      "Copilot 问答",
      "llms.txt 生成器",
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
      "多门店汇总视图",
      "团队成员权限",
      "协议化导出（Webhook / API）",
      "包含 Pro 的所有功能",
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

