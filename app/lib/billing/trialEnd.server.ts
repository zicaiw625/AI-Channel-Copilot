import { DAY_IN_MS } from "./state.server";

export type ResolveAppSubscriptionTrialEndOptions = {
  /** Webhook `app_subscription.trial_end` 等 Shopify 直接给出的结束时间（优先） */
  trialEndFromShopify?: Date | null;
  /** Admin GraphQL `AppSubscription.createdAt` */
  createdAt?: Date | null;
  /** Admin GraphQL `AppSubscription.trialDays` */
  trialDays?: number | null;
};

/**
 * 统一解析应用订阅的试用结束时刻。
 * - 有明确 `trial_end` 时（Webhook / 将来若 GraphQL 暴露同字段）始终优先；
 * - 否则按 Shopify 文档：试用从订阅创建日起计 `trialDays` 天（GraphQL 同步路径）。
 */
export function resolveAppSubscriptionTrialEnd(
  options: ResolveAppSubscriptionTrialEndOptions,
): Date | null {
  const explicit = options.trialEndFromShopify;
  if (explicit != null) {
    const t = explicit.getTime();
    if (!Number.isNaN(t)) return explicit;
    return null;
  }
  const td = options.trialDays ?? 0;
  if (td <= 0 || !options.createdAt) return null;
  return new Date(options.createdAt.getTime() + td * DAY_IN_MS);
}

export function isTrialEndInFuture(trialEnd: Date | null, asOf = Date.now()): boolean {
  return trialEnd != null && trialEnd.getTime() > asOf;
}
