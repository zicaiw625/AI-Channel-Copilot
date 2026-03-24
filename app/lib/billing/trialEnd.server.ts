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
 * - 否则用 `createdAt + trialDays`（Admin GraphQL 文档口径）。注意：`createdAt` 常为创建收费时间，
 *   可能早于商户批准日；同步逻辑会与库中 Webhook 写入的 `lastTrialEndAt` 取较晚者，避免误缩短试用。
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
