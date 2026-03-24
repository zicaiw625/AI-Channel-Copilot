/**
 * Shopify Billing API Operations
 * 与 Shopify GraphQL API 的计费相关交互
 */

import { isNonProduction, readAppFlags, getAppConfig } from "../env.server";
import { createGraphqlSdk, type AdminGraphqlClient } from "../graphqlSdk.server";
import { logger } from "../logger.server";
import { withAdvisoryLock } from "../locks.server";
import {
  getPlanConfig,
  resolvePlanByShopifyName,
  PRIMARY_BILLABLE_PLAN_ID,
  type PlanId,
} from "./plans";
import {
  getBillingState,
  upsertBillingState,
  setSubscriptionTrialState,
  setSubscriptionActiveState,
  setSubscriptionExpiredState,
  DAY_IN_MS,
  toPlanId,
  type BillingState,
} from "./state.server";
import { isTrialEndInFuture, resolveAppSubscriptionTrialEnd } from "./trialEnd.server";

// ============================================================================
// Internal Helpers
// ============================================================================

// FNV-1a hash for generating lock keys
const hashForLock = (str: string, offset: number): number => {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) + offset;
};

// Lock key offsets to avoid collisions
const LOCK_OFFSET_SYNC = 0x60000000;  // subscription sync

// GraphQL 响应类型定义
type UserError = { field?: string | null; message: string };

type CancelSubscriptionResponse = {
  data?: {
    appSubscriptionCancel?: {
      userErrors?: UserError[];
      appSubscription?: { id: string; status: string };
    };
  };
};

type CreateSubscriptionResponse = {
  data?: {
    appSubscriptionCreate?: {
      userErrors?: UserError[];
      confirmationUrl?: string;
      appSubscription?: { id: string };
    };
  };
};

export type ActiveSubscriptionInfo = {
  id: string;
  name: string;
  status: string;
  trialDays: number | null;
  createdAt: Date | null;
  currentPeriodEnd: Date | null;
};

export type PaidSubscriptionInfo = {
  id: string;
  planId: PlanId;
  status: string;
  createdAt: Date | null;
};

// ============================================================================
// Dev Shop Detection
// ============================================================================

export const detectAndPersistDevShop = async (
  admin: AdminGraphqlClient | null,
  shopDomain: string,
): Promise<boolean> => {
  const existing = await getBillingState(shopDomain);
  
  // If no admin client, return cached value or default to false
  if (!admin) {
    if (existing && typeof existing.isDevShop === "boolean") return existing.isDevShop;
    return false;
  }
  
  // 不再依赖 lastCheckedAt 做开发店探测缓存：
  // 该字段也会被其它 billing 状态写入刷新，容易导致 isDevShop 长时间陈旧。
  // 只要有 admin client，就实时查询 Shopify；查询失败时再回退到缓存值。

  const sdk = createGraphqlSdk(admin, shopDomain);
  // 使用 partnerDevelopment 字段来可靠地判断开发店
  const query = `#graphql
    query ShopPlanForBilling {
      shop {
        plan {
          partnerDevelopment
          displayName
        }
      }
    }
  `;
  
  // Wrap in try-catch to handle token issues gracefully
  let response;
  try {
    response = await sdk.request("shopPlan", query, {});
  } catch (error) {
    logger.warn("detectAndPersistDevShop GraphQL failed, using cached value", {
      shopDomain,
      error: (error as Error).message,
    });
    if (existing && typeof existing.isDevShop === "boolean") return existing.isDevShop;
    return false;
  }
  
  if (!response.ok) {
    if (existing && typeof existing.isDevShop === "boolean") return existing.isDevShop;
    return false;
  }
  
  const json = (await response.json()) as { 
    data?: { shop?: { plan?: { partnerDevelopment?: boolean; displayName?: string | null } } };
    errors?: Array<{ message: string }>;
  };
  
  // 检查 GraphQL 错误
  if (json.errors?.length) {
    logger.warn("detectAndPersistDevShop GraphQL errors", {
      shopDomain,
      errors: json.errors.map(e => e.message).join("; "),
    });
    if (existing && typeof existing.isDevShop === "boolean") return existing.isDevShop;
    return false;
  }
  
  const plan = json?.data?.shop?.plan;
  // 优先使用 partnerDevelopment 字段（官方推荐）
  const isDev = plan?.partnerDevelopment === true || 
    (plan?.displayName?.toLowerCase() || "").includes("development") ||
    (plan?.displayName?.toLowerCase() || "").includes("affiliate");
  
  const updates: Partial<BillingState> = { isDevShop: isDev };
  if (!existing?.firstInstalledAt) {
    updates.firstInstalledAt = new Date();
  }
  
  // Handle reinstall scenario
  const isReinstall = existing?.lastUninstalledAt && 
    (!existing?.lastReinstalledAt || existing.lastReinstalledAt < existing.lastUninstalledAt);
  
  if (isReinstall) {
    updates.lastReinstalledAt = new Date();
    logger.info("[billing] Detected reinstall, will sync subscription", { shopDomain });
  }
  
  await upsertBillingState(shopDomain, updates);
  
  // If this is a reinstall OR billing state is CANCELLED, sync subscription from Shopify
  const needsSubscriptionSync = isReinstall || existing?.billingState === "CANCELLED";
  
  if (needsSubscriptionSync && !isDev) {
    const syncResult = await syncSubscriptionFromShopify(admin, shopDomain);
    if (syncResult.synced) {
      logger.info("[billing] Subscription synced after reinstall", { 
        shopDomain, 
        status: syncResult.status,
        planId: syncResult.planId,
      });
    }
  }
  
  return isDev;
};

// ============================================================================
// Subscription Sync
// ============================================================================

/**
 * 内部订阅同步逻辑（不带锁）
 */
const syncSubscriptionFromShopifyInternal = async (
  admin: AdminGraphqlClient,
  shopDomain: string,
  maxRetries = 3,
): Promise<{ synced: boolean; status?: string; planId?: PlanId }> => {
  const QUERY = `#graphql
    query ActiveSubscriptionsForSync {
      currentAppInstallation {
        activeSubscriptions { 
          id 
          name 
          status 
          trialDays 
          createdAt
          currentPeriodEnd
        }
      }
    }
  `;

  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const sdk = createGraphqlSdk(admin, shopDomain);
      const resp = await sdk.request("activeSubscriptionsForSync", QUERY, {});
      
      if (resp.ok) {
        const json = (await resp.json()) as {
          data?: { 
            currentAppInstallation?: { 
              activeSubscriptions?: { 
                id: string; 
                name: string; 
                status: string;
                trialDays?: number | null;
                createdAt?: string | null;
                currentPeriodEnd?: string | null;
              }[] 
            } 
          };
        };
        
        const subs = json.data?.currentAppInstallation?.activeSubscriptions || [];
        
        // Find our app's active subscription
        const activeSub = subs.find((s) => {
          const plan = resolvePlanByShopifyName(s.name);
          return plan && (s.status === "ACTIVE" || s.status === "PENDING");
        });
        
        if (!activeSub) {
          logger.info("[billing] No active subscription found on Shopify", { shopDomain });
          const existingState = await getBillingState(shopDomain);

          const isFreePlan =
            existingState?.billingPlan === "free" &&
            existingState?.billingState === "FREE_ACTIVE";
          const isNoPlan = existingState?.billingState === "NO_PLAN";

          if (existingState && !isFreePlan && !isNoPlan) {
            const planId = toPlanId(existingState.billingPlan);
            if (planId) {
              await setSubscriptionExpiredState(shopDomain, planId, "NONE");
            } else {
              await upsertBillingState(shopDomain, {
                billingPlan: "NO_PLAN",
                billingState: "EXPIRED_NO_SUBSCRIPTION",
                lastSubscriptionStatus: "NONE",
                lastTrialStartAt: null,
                lastTrialEndAt: null,
              });
            }
          }

          return { synced: true, status: "NONE" };
        }
        
        const plan = resolvePlanByShopifyName(activeSub.name);
        if (!plan) {
          logger.warn("[billing] Unknown plan name from Shopify", { shopDomain, planName: activeSub.name });
          return { synced: false };
        }
        
        // GraphQL 的 createdAt 多为「创建收费/待批准」时间；试用从商户批准日开始。
        // 仅用 createdAt + trialDays 会在批准较晚时把 trialEnd 算得过早（例如误显示剩 4 天）。
        // 若库中已有 Webhook 写入的更晚的 lastTrialEndAt，取较晚者，避免同步覆盖正确试用结束时间。
        const createdAt = activeSub.createdAt ? new Date(activeSub.createdAt) : null;
        const trialDays = activeSub.trialDays ?? 0;
        let trialEnd = resolveAppSubscriptionTrialEnd({
          createdAt,
          trialDays,
        });
        const existingForMerge = await getBillingState(shopDomain);
        if (
          trialDays > 0 &&
          existingForMerge?.lastTrialEndAt &&
          existingForMerge.lastTrialEndAt.getTime() > Date.now()
        ) {
          const derivedMs = trialEnd?.getTime() ?? 0;
          trialEnd = new Date(
            Math.max(derivedMs, existingForMerge.lastTrialEndAt.getTime()),
          );
        }

        const isTrialing = isTrialEndInFuture(trialEnd);

        // Update local billing state
        if (isTrialing && plan.trialSupported) {
          await setSubscriptionTrialState(
            shopDomain,
            plan.id,
            trialEnd,
            activeSub.status,
            trialDays > 0 ? trialDays : null,
          );
        } else {
          await setSubscriptionActiveState(shopDomain, plan.id, activeSub.status);
        }
        
        return { synced: true, status: activeSub.status, planId: plan.id };
      }
      
      // Check if error is retryable (5xx or 429)
      if (resp.status >= 500 || resp.status === 429) {
        lastError = new Error(`HTTP ${resp.status}`);
        logger.warn("[billing] Retryable error syncing subscription", { 
          shopDomain, 
          status: resp.status,
          attempt: attempt + 1,
          maxRetries,
        });
        await new Promise(r => setTimeout(r, Math.min(1000 * Math.pow(2, attempt), 10000)));
        continue;
      }
      
      // 4xx errors are not retryable
      logger.warn("[billing] Non-retryable error syncing subscription", { 
        shopDomain, 
        status: resp.status,
      });
      return { synced: false };
      
    } catch (error) {
      lastError = error as Error;
      logger.warn("[billing] Exception syncing subscription", { 
        shopDomain, 
        attempt: attempt + 1,
        error: (error as Error).message,
      });
      
      if (attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
      }
    }
  }
  
  logger.error("[billing] Failed to sync subscription after retries", { 
    shopDomain, 
    attempts: maxRetries,
    error: lastError?.message,
  });
  return { synced: false };
};

/**
 * Sync subscription status from Shopify Billing API
 * Uses advisory lock to prevent concurrent sync operations
 */
export const syncSubscriptionFromShopify = async (
  admin: AdminGraphqlClient,
  shopDomain: string,
  maxRetries = 3,
): Promise<{ synced: boolean; status?: string; planId?: PlanId }> => {
  const lockKey = hashForLock(shopDomain, LOCK_OFFSET_SYNC);
  
  const { result, lockInfo } = await withAdvisoryLock(
    lockKey,
    () => syncSubscriptionFromShopifyInternal(admin, shopDomain, maxRetries),
    { fallbackOnError: false }
  );
  
  if (!lockInfo.acquired) {
    logger.debug("[billing] Subscription sync skipped (lock held)", { shopDomain });
    return { synced: false };
  }
  
  return result ?? { synced: false };
};

// ============================================================================
// Subscription Query Functions
// ============================================================================

export const hasActiveSubscription = async (
  admin: AdminGraphqlClient,
  planName: string,
): Promise<boolean> => {
  const sdk = createGraphqlSdk(admin);
  const ACTIVE_QUERY = `#graphql
    query ActiveSubscriptions {
      currentAppInstallation {
        activeSubscriptions { id name status }
      }
    }
  `;
  const resp = await sdk.request("activeSubscriptions", ACTIVE_QUERY, {});
  if (!resp.ok) return false;
  const json = (await resp.json()) as {
    data?: { currentAppInstallation?: { activeSubscriptions?: { id: string; name: string; status: string }[] } };
  };
  const subs = json.data?.currentAppInstallation?.activeSubscriptions || [];
  return subs.some((s) => s.name === planName && s.status === "ACTIVE");
};

export const getActiveSubscriptionDetails = async (
  admin: AdminGraphqlClient,
  planName: string,
): Promise<{ id: string; name: string; status: string | null; trialDays: number | null; currentPeriodEnd: Date | null } | null> => {
  const sdk = createGraphqlSdk(admin);
  const QUERY = `#graphql
    query ActiveSubscriptionDetails {
      currentAppInstallation {
        activeSubscriptions { id name status trialDays currentPeriodEnd }
      }
    }
  `;
  const resp = await sdk.request("activeSubscriptionDetails", QUERY, {});
  if (!resp.ok) return null;
  const json = (await resp.json()) as {
    data?: { currentAppInstallation?: { activeSubscriptions?: { id: string; name: string; status: string; trialDays?: number | null; currentPeriodEnd?: string | null }[] } };
  };
  const subs = json.data?.currentAppInstallation?.activeSubscriptions || [];
  const sub = subs.find((s) => s.name === planName) || null;
  if (!sub) return null;
  const currentPeriodEnd = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null;
  return { id: sub.id, name: sub.name, status: sub.status || null, trialDays: sub.trialDays ?? null, currentPeriodEnd };
};

export const listActiveSubscriptions = async (
  admin: AdminGraphqlClient,
  shopDomain?: string,
): Promise<ActiveSubscriptionInfo[]> => {
  const sdk = createGraphqlSdk(admin, shopDomain);
  const QUERY = `#graphql
    query ActiveSubscriptionsList {
      currentAppInstallation {
        activeSubscriptions { id name status trialDays createdAt currentPeriodEnd }
      }
    }
  `;
  const resp = await sdk.request("activeSubscriptionsList", QUERY, {});
  if (!resp.ok) {
    throw new Error("Failed to fetch active subscriptions");
  }
  const json = (await resp.json()) as {
    data?: { currentAppInstallation?: { activeSubscriptions?: { id: string; name: string; status: string; trialDays?: number | null; createdAt?: string | null; currentPeriodEnd?: string | null }[] } };
  };
  const subs = json.data?.currentAppInstallation?.activeSubscriptions || [];
  return subs.map((s) => ({
    id: s.id,
    name: s.name,
    status: s.status,
    trialDays: s.trialDays ?? null,
    createdAt: s.createdAt ? new Date(s.createdAt) : null,
    currentPeriodEnd: s.currentPeriodEnd ? new Date(s.currentPeriodEnd) : null,
  }));
};

export const listPaidSubscriptions = async (
  admin: AdminGraphqlClient,
  shopDomain?: string,
): Promise<PaidSubscriptionInfo[]> => {
  const subs = await listActiveSubscriptions(admin, shopDomain);
  const paid: PaidSubscriptionInfo[] = [];
  for (const sub of subs) {
    const plan = resolvePlanByShopifyName(sub.name);
    if (!plan || plan.priceUsd <= 0) continue;
    paid.push({
      id: sub.id,
      planId: plan.id,
      status: sub.status,
      createdAt: sub.createdAt,
    });
  }
  return paid;
};

// ============================================================================
// Subscription Operations
// ============================================================================

export const cancelSubscription = async (
  admin: AdminGraphqlClient,
  subscriptionId: string,
  prorate = true,
): Promise<string | null> => {
  const sdk = createGraphqlSdk(admin);
  const MUTATION = `#graphql
    mutation CancelAppSubscription($id: ID!, $prorate: Boolean) {
      appSubscriptionCancel(id: $id, prorate: $prorate) {
        userErrors { field message }
        appSubscription { id status }
      }
    }
  `;
  const resp = await sdk.request("cancelSubscription", MUTATION, { id: subscriptionId, prorate });
  if (!resp.ok) throw new Error("Failed to cancel subscription");
  const json = (await resp.json()) as CancelSubscriptionResponse;
  const errors = json.data?.appSubscriptionCancel?.userErrors || [];
  if (errors.length > 0) {
    throw new Error(errors.map((e) => e.message).join(", "));
  }
  return json.data?.appSubscriptionCancel?.appSubscription?.status || null;
};

export const requestSubscription = async (
  admin: AdminGraphqlClient,
  shopDomain: string,
  planId: PlanId,
  isTest: boolean,
  trialDays: number,
  returnUrlContext?: {
    host?: string | null;
    embedded?: string | null;
    locale?: string | null;
  },
): Promise<string | undefined> => {
  const plan = getPlanConfig(planId);
  if (plan.priceUsd <= 0) {
    throw new Error(`Plan ${planId} does not require a Shopify subscription.`);
  }

  // 兜底：对 dev store 必须使用 test charge
  let effectiveIsTest = isTest;
  if (!effectiveIsTest) {
    try {
      await detectAndPersistDevShop(admin, shopDomain);
      effectiveIsTest = await computeIsTestMode(shopDomain);
    } catch (e) {
      logger.warn("[billing] Failed to re-evaluate test mode, using provided flag", {
        shopDomain,
        planId,
        isTestProvided: isTest,
        error: (e as Error).message,
      });
    }
  }

  const cfg = getAppConfig();
  const amount = plan.priceUsd;
  const currencyCode = cfg.billing.currencyCode;
  const interval = cfg.billing.interval;
  
  const returnUrlUrl = new URL("/app/billing/confirm", cfg.server.appUrl);
  returnUrlUrl.searchParams.set("shop", shopDomain);
  if (returnUrlContext?.host) returnUrlUrl.searchParams.set("host", returnUrlContext.host);
  if (returnUrlContext?.embedded) returnUrlUrl.searchParams.set("embedded", returnUrlContext.embedded);
  if (returnUrlContext?.locale) returnUrlUrl.searchParams.set("locale", returnUrlContext.locale);
  const returnUrl = returnUrlUrl.toString();

  const MUTATION = `#graphql
    mutation AppSubscriptionCreate($name: String!, $lineItems: [AppSubscriptionLineItemInput!]!, $returnUrl: URL!, $test: Boolean, $trialDays: Int) {
      appSubscriptionCreate(
        name: $name,
        lineItems: $lineItems,
        returnUrl: $returnUrl,
        test: $test,
        trialDays: $trialDays
      ) {
        userErrors { field message }
        confirmationUrl
        appSubscription { id }
      }
    }
  `;
  const sdk = createGraphqlSdk(admin, shopDomain);
  const resp = await sdk.request("createSubscription", MUTATION, {
    name: plan.shopifyName,
    lineItems: [
      {
        plan: {
          appRecurringPricingDetails: {
            interval,
            price: {
              amount,
              currencyCode,
            },
          },
        },
      },
    ],
    returnUrl,
    test: effectiveIsTest,
    trialDays: plan.trialSupported ? Math.max(trialDays, 0) : 0,
  });

  if (!resp.ok) {
    throw new Error("Failed to create subscription request");
  }

  const json = (await resp.json()) as CreateSubscriptionResponse;
  const errors = json.data?.appSubscriptionCreate?.userErrors || [];
  if (errors.length > 0) {
    throw new Error(errors.map((e) => e.message).join(", "));
  }

  return json.data?.appSubscriptionCreate?.confirmationUrl;
};

// ============================================================================
// Helper Functions
// ============================================================================

export const computeIsTestMode = async (shopDomain: string): Promise<boolean> => {
  if (readAppFlags().billingForceTest) return true;
  const state = await getBillingState(shopDomain);
  if (state?.isDevShop) return true;
  return isNonProduction();
};

export const shouldSkipBillingForPath = (pathname: string, isDevShop: boolean): boolean => {
  void isDevShop;
  const path = pathname.toLowerCase();
  if (path.includes("/webhooks/")) return true;
  if (path.includes("/public") || path.endsWith(".css") || path.endsWith(".js")) return true;
  if (path.includes("/app/onboarding") || path.includes("/app/billing") || path.includes("/app/redirect")) return true;
  return false;
};

// Calculate remaining trial days based on installation history and usage
export const calculateRemainingTrialDays = async (
  shopDomain: string,
  planId: PlanId = PRIMARY_BILLABLE_PLAN_ID,
): Promise<number> => {
  const plan = getPlanConfig(planId);
  if (!plan.trialSupported) return 0;
  const state = await getBillingState(shopDomain);
  if (!state) return plan.defaultTrialDays;

  // 已转为正式付费（ACTIVE）时本地会清空 lastTrialEndAt；若仍用「默认试用天数 − usedTrialDays」
  // 会误显示剩余试用。usedTrialDays 为全店维度，用「错误 planId」（如 Growth 用户按默认 pro 算）也会错。
  // 任意 Pro/Growth 正式订阅（非 TRIALING）均视为当前无进行中的应用试用。
  const subscribedPlanId = toPlanId(state.billingPlan);
  if (
    (subscribedPlanId === "pro" || subscribedPlanId === "growth") &&
    state.billingState.includes("ACTIVE") &&
    !state.billingState.includes("TRIALING")
  ) {
    return 0;
  }

  if (state.lastTrialEndAt && state.lastTrialEndAt.getTime() > Date.now()) {
    const diff = Math.ceil((state.lastTrialEndAt.getTime() - Date.now()) / DAY_IN_MS);
    return Math.max(diff, 0);
  }

  if (state.lastTrialEndAt && state.lastTrialEndAt.getTime() <= Date.now()) {
    return 0;
  }

  const remainingBudget = Math.max(plan.defaultTrialDays - (state.usedTrialDays || 0), 0);
  
  if (state.hasEverSubscribed && toPlanId(state.billingPlan) === plan.id) {
    if (remainingBudget <= 0) {
      return 0;
    }
    return remainingBudget;
  }
  
  return remainingBudget;
};

export const shouldOfferTrial = async (shopDomain: string, planId?: PlanId): Promise<number> => {
  return calculateRemainingTrialDays(shopDomain, planId);
};

// Legacy function for backward compatibility
export const ensureBilling = async (
  _admin: AdminGraphqlClient,
  _shopDomain: string,
  _request: Request,
): Promise<void> => {
  return;
};
