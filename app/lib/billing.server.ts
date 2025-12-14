import prisma from "../db.server";
import { isNonProduction, readAppFlags, getAppConfig } from "./env.server";
import { isSchemaMissing, isIgnorableMigrationError, isInitializationError } from "./prismaErrors";
import { createGraphqlSdk, type AdminGraphqlClient } from "./graphqlSdk.server";
import { logger } from "./logger.server";
import { withAdvisoryLock } from "./locks.server";
import {
  PRIMARY_BILLABLE_PLAN_ID,
  getPlanConfig,
  resolvePlanByShopifyName,
  type PlanConfig,
  type PlanId,
} from "./billing/plans";

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

export type BillingState = {
  shopDomain: string;
  isDevShop: boolean;
  
  billingPlan: string;
  billingState: string;
  
  firstInstalledAt: Date | null;
  lastTrialStartAt?: Date | null;
  lastTrialEndAt?: Date | null;
  usedTrialDays: number;
  
  hasEverSubscribed: boolean;
  lastSubscriptionStatus?: string | null;
  lastCheckedAt?: Date | null;
  lastUninstalledAt?: Date | null;
  lastReinstalledAt?: Date | null;
};

const DAY_IN_MS = 24 * 60 * 60 * 1000;

/**
 * Shopify 店铺域名格式正则
 * 有效格式: xxx.myshopify.com 或 xxx-xxx.myshopify.com
 */
const SHOP_DOMAIN_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;

/**
 * 验证 shopDomain 是否为有效的 Shopify 店铺域名
 * 防止无效数据写入数据库和日志污染
 */
export const isValidShopDomain = (domain: unknown): domain is string => {
  if (!domain || typeof domain !== "string") return false;
  if (domain.length > 255 || domain.length < 14) return false; // 最短: x.myshopify.com = 14 字符
  return SHOP_DOMAIN_REGEX.test(domain);
};

/**
 * 验证 shopDomain，无效时记录警告并返回 null
 * 用于需要安全处理的场景
 */
const validateShopDomain = (shopDomain: string, context: string): string | null => {
  if (!isValidShopDomain(shopDomain)) {
    // 使用 String() 确保类型安全，即使传入 undefined/null
    const displayDomain = shopDomain ? String(shopDomain).slice(0, 50) : "(empty)";
    logger.warn(`[billing] Invalid shop domain in ${context}`, { 
      shopDomain: displayDomain,
    });
    return null;
  }
  return shopDomain;
};

const toPlanId = (raw?: string | null): PlanId => {
  if (raw === "free" || raw === "pro" || raw === "growth") return raw;
  return PRIMARY_BILLABLE_PLAN_ID;
};

const planStateKey = (planId: PlanId, suffix: "TRIALING" | "ACTIVE" | "EXPIRED" | "CANCELLED" | "NO_PLAN") =>
  `${planId.toUpperCase()}_${suffix}`;

const computeIncrementalTrialUsage = (state: BillingState, plan: PlanConfig, asOf: Date) => {
  if (!plan.trialSupported || !state.lastTrialStartAt) return 0;
  const start = state.lastTrialStartAt.getTime();
  const end =
    state.lastTrialEndAt?.getTime() ?? start + plan.defaultTrialDays * DAY_IN_MS;
  const windowEnd = Math.min(end, asOf.getTime());
  if (windowEnd <= start) return 0;
  // 使用 Math.floor 而非 Math.ceil，避免在边界情况下多算一天
  // 例如：开始于 12:00，12:01 不应算作 1 天
  const diff = Math.floor((windowEnd - start) / DAY_IN_MS);
  return Math.min(plan.defaultTrialDays, Math.max(diff, 0));
};

const applyTrialConsumption = async (
  shopDomain: string,
  state: BillingState,
  plan: PlanConfig,
  asOf = new Date(),
) => {
  if (!plan.trialSupported) return;
  const incremental = computeIncrementalTrialUsage(state, plan, asOf);
  if (!incremental) return;
  const nextUsed = Math.min(plan.defaultTrialDays, (state.usedTrialDays || 0) + incremental);
  await upsertBillingState(shopDomain, {
    usedTrialDays: nextUsed,
    lastTrialStartAt: null,
    lastTrialEndAt: null,
  });
};

export const activateFreePlan = async (shopDomain: string) => {
  await upsertBillingState(shopDomain, {
    billingPlan: "free",
    billingState: "FREE_ACTIVE",
    lastSubscriptionStatus: "FREE",
    lastTrialStartAt: null,
    lastTrialEndAt: null,
  });
};

export const setSubscriptionTrialState = async (
  shopDomain: string,
  planId: PlanId,
  trialEnd: Date | null,
  status = "ACTIVE",
) => {
  const plan = getPlanConfig(planId);
  if (!plan.trialSupported) {
    await setSubscriptionActiveState(shopDomain, planId, status);
    return;
  }
  const now = new Date();
  const computedTrialEnd =
    trialEnd ?? new Date(now.getTime() + plan.defaultTrialDays * DAY_IN_MS);
  await upsertBillingState(shopDomain, {
    billingPlan: planId,
    billingState: planStateKey(planId, "TRIALING"),
    lastTrialStartAt: now,
    lastTrialEndAt: computedTrialEnd,
    lastSubscriptionStatus: status,
    hasEverSubscribed: true,
  });
};

export const setSubscriptionActiveState = async (
  shopDomain: string,
  planId: PlanId,
  status = "ACTIVE",
) => {
  const plan = getPlanConfig(planId);
  const state = await getBillingState(shopDomain);
  if (state) {
    await applyTrialConsumption(shopDomain, state, plan);
  }
  await upsertBillingState(shopDomain, {
    billingPlan: planId,
    billingState: planStateKey(planId, "ACTIVE"),
    lastSubscriptionStatus: status,
    hasEverSubscribed: true,
  });
};

export const setSubscriptionExpiredState = async (
  shopDomain: string,
  planId: PlanId,
  status = "EXPIRED",
) => {
  const plan = getPlanConfig(planId);
  const state = await getBillingState(shopDomain);
  if (state) {
    await applyTrialConsumption(shopDomain, state, plan);
  }
  await upsertBillingState(shopDomain, {
    billingPlan: planId,
    billingState: "EXPIRED_NO_SUBSCRIPTION",
    lastSubscriptionStatus: status,
  });
};

export const markShopUninstalled = async (shopDomain: string) => {
  await upsertBillingState(shopDomain, {
    billingState: "CANCELLED",
    lastUninstalledAt: new Date(),
  });
};

export const getBillingState = async (shopDomain: string): Promise<BillingState | null> => {
  // 验证 shopDomain 格式
  const validDomain = validateShopDomain(shopDomain, "getBillingState");
  if (!validDomain) return null;
  
  try {
    const record = await prisma.shopBillingState.findUnique({
      where: { shopDomain_platform: { shopDomain, platform: "shopify" } },
    });
    return record
      ? {
        shopDomain,
        isDevShop: record.isDevShop,
        billingPlan: record.billingPlan,
        billingState: record.billingState,
        firstInstalledAt: record.firstInstalledAt,
        lastTrialStartAt: record.lastTrialStartAt || null,
        lastTrialEndAt: record.lastTrialEndAt || null,
        usedTrialDays: record.usedTrialDays,
        hasEverSubscribed: record.hasEverSubscribed,
        lastSubscriptionStatus: record.lastSubscriptionStatus,
        lastCheckedAt: record.lastCheckedAt || null,
        lastUninstalledAt: record.lastUninstalledAt || null,
        lastReinstalledAt: record.lastReinstalledAt || null,
      }
      : null;
  } catch (error) {
    if (isSchemaMissing(error) || isInitializationError(error)) return null;
    throw error;
  }
};

// 定义 payload 的类型
type BillingStatePayload = {
  isDevShop?: boolean;
  billingPlan?: string;
  billingState?: string;
  firstInstalledAt?: Date | null;
  usedTrialDays?: number;
  hasEverSubscribed?: boolean;
  lastSubscriptionStatus?: string | null;
  lastTrialStartAt?: Date | null;
  lastTrialEndAt?: Date | null;
  lastCheckedAt?: Date | null;
  lastUninstalledAt?: Date | null;
  lastReinstalledAt?: Date | null;
};

// Prisma 返回的记录类型
type BillingStateRecord = {
  isDevShop: boolean;
  billingPlan: string;
  billingState: string;
  firstInstalledAt: Date | null;
  usedTrialDays: number;
  hasEverSubscribed: boolean;
  lastSubscriptionStatus: string | null;
  lastTrialStartAt: Date | null;
  lastTrialEndAt: Date | null;
  lastCheckedAt: Date | null;
  lastUninstalledAt: Date | null;
  lastReinstalledAt: Date | null;
};

/**
 * 将数据库记录转换为 BillingState 对象
 * 统一处理 null 值的转换
 */
const recordToBillingState = (shopDomain: string, record: BillingStateRecord): BillingState => ({
  shopDomain,
  isDevShop: record.isDevShop,
  billingPlan: record.billingPlan,
  billingState: record.billingState,
  firstInstalledAt: record.firstInstalledAt,
  usedTrialDays: record.usedTrialDays,
  hasEverSubscribed: record.hasEverSubscribed,
  lastSubscriptionStatus: record.lastSubscriptionStatus,
  lastTrialStartAt: record.lastTrialStartAt || null,
  lastTrialEndAt: record.lastTrialEndAt || null,
  lastCheckedAt: record.lastCheckedAt || null,
  lastUninstalledAt: record.lastUninstalledAt || null,
  lastReinstalledAt: record.lastReinstalledAt || null,
});

/**
 * 创建用于测试/无数据库环境的最小状态对象
 */
const createMinimalBillingState = (
  shopDomain: string, 
  updates: Partial<BillingState>
): BillingState => ({
  shopDomain,
  isDevShop: false,
  billingPlan: updates.billingPlan || "NO_PLAN",
  billingState: updates.billingState || "NO_PLAN",
  firstInstalledAt: null,
  usedTrialDays: updates.usedTrialDays || 0,
  hasEverSubscribed: updates.hasEverSubscribed ?? false,
  lastSubscriptionStatus: updates.lastSubscriptionStatus || null,
  lastTrialStartAt: updates.lastTrialStartAt || null,
  lastTrialEndAt: updates.lastTrialEndAt || null,
  lastCheckedAt: updates.lastCheckedAt || null,
  lastUninstalledAt: updates.lastUninstalledAt || null,
  lastReinstalledAt: updates.lastReinstalledAt || null,
});

export const upsertBillingState = async (
  shopDomain: string,
  updates: Partial<BillingState>,
): Promise<BillingState> => {
  // 验证 shopDomain 格式
  const validDomain = validateShopDomain(shopDomain, "upsertBillingState");
  if (!validDomain) {
    throw new Error(`Invalid shop domain: ${shopDomain?.slice(0, 50) || "(empty)"}`);
  }
  
  const payload: BillingStatePayload = {
    isDevShop: updates.isDevShop ?? false,
    billingPlan: updates.billingPlan,
    billingState: updates.billingState,
    firstInstalledAt: updates.firstInstalledAt,
    usedTrialDays: updates.usedTrialDays,
    hasEverSubscribed: updates.hasEverSubscribed ?? false,
    lastSubscriptionStatus: updates.lastSubscriptionStatus,
    lastTrialStartAt: updates.lastTrialStartAt || null,
    lastTrialEndAt: updates.lastTrialEndAt || null,
    lastCheckedAt: updates.lastCheckedAt || new Date(),
    lastUninstalledAt: updates.lastUninstalledAt || null,
    lastReinstalledAt: updates.lastReinstalledAt || null,
  };
  
  // Clean undefined values - use type-safe approach
  const cleanedPayload = Object.fromEntries(
    Object.entries(payload).filter(([_, value]) => value !== undefined)
  ) as BillingStatePayload;

  const createData = {
    shopDomain, 
    platform: "shopify", 
    ...cleanedPayload,
    billingPlan: cleanedPayload.billingPlan || updates.billingPlan || "NO_PLAN",
    billingState: cleanedPayload.billingState || updates.billingState || "NO_PLAN",
    usedTrialDays: cleanedPayload.usedTrialDays ?? updates.usedTrialDays ?? 0,
  };

  try {
    const record = await prisma.shopBillingState.upsert({
      where: { shopDomain_platform: { shopDomain, platform: "shopify" } },
      update: cleanedPayload,
      create: createData,
    });
    return recordToBillingState(shopDomain, record);
  } catch (error) {
    if (!isIgnorableMigrationError(error)) {
      if (isInitializationError(error)) {
        // In test or no-DB environments, skip persistence and return a minimal state
        return createMinimalBillingState(shopDomain, updates);
      }
      throw error;
    }
    
    // Migration error fallback: try find + update/create
    const existing = await prisma.shopBillingState.findFirst({ 
      where: { shopDomain, platform: "shopify" } 
    });
    
    if (existing) {
      const updated = await prisma.shopBillingState.update({
        where: { id: existing.id },
        data: cleanedPayload,
      });
      return recordToBillingState(shopDomain, updated);
    }
    
    const created = await prisma.shopBillingState.create({ data: createData });
    return recordToBillingState(shopDomain, created);
  }
};

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
          return { synced: true, status: "NONE" };
        }
        
        const plan = resolvePlanByShopifyName(activeSub.name);
        if (!plan) {
          logger.warn("[billing] Unknown plan name from Shopify", { shopDomain, planName: activeSub.name });
          return { synced: false };
        }
        
        // Check if it's trialing
        const trialEnd = activeSub.currentPeriodEnd ? new Date(activeSub.currentPeriodEnd) : null;
        const isTrialing = activeSub.trialDays && activeSub.trialDays > 0 && trialEnd && trialEnd.getTime() > Date.now();
        
        logger.info("[billing] Syncing subscription from Shopify", { 
          shopDomain, 
          planId: plan.id,
          status: activeSub.status,
          isTrialing,
          trialDays: activeSub.trialDays,
        });
        
        // Update local billing state
        if (isTrialing && plan.trialSupported) {
          await setSubscriptionTrialState(shopDomain, plan.id, trialEnd, activeSub.status);
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
        // Exponential backoff: 1s, 2s, 4s
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
        // Exponential backoff
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
 * This is crucial for reinstall scenarios where the subscription may still be active
 * Uses advisory lock to prevent concurrent sync operations for the same shop
 * 
 * @param admin - Shopify Admin GraphQL client
 * @param shopDomain - Shop domain
 * @param maxRetries - Maximum number of retry attempts (default: 3)
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
    // Another request is already syncing for this shop
    logger.debug("[billing] Subscription sync skipped (lock held)", { shopDomain });
    return { synced: false };
  }
  
  return result ?? { synced: false };
};

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
  
  // Safety check: If we have cached data and it's recent (within 24 hours), use it
  // This prevents unnecessary API calls and handles cases where admin token might be invalid
  if (existing?.lastCheckedAt && existing.isDevShop !== undefined) {
    const hoursSinceCheck = (Date.now() - existing.lastCheckedAt.getTime()) / (1000 * 60 * 60);
    if (hoursSinceCheck < 24) {
      // Check if this is a reinstall that needs subscription sync
      const isReinstall = existing.lastUninstalledAt && 
        (!existing.lastReinstalledAt || existing.lastReinstalledAt < existing.lastUninstalledAt);
      const needsSync = isReinstall || existing.billingState === "CANCELLED";
      
      if (!needsSync) {
        return existing.isDevShop;
      }
    }
  }

  const sdk = createGraphqlSdk(admin, shopDomain);
  // 使用 partnerDevelopment 字段来可靠地判断开发店
  // 参考: https://shopify.dev/docs/api/admin-graphql/latest/objects/ShopPlan
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
    // If GraphQL fails (e.g., invalid token), return cached value or false
    logger.warn("detectAndPersistDevShop GraphQL failed, using cached value", {
      shopDomain,
      error: (error as Error).message,
    });
    if (existing && typeof existing.isDevShop === "boolean") return existing.isDevShop;
    return false;
  }
  
  if (!response.ok) {
    // Response not OK, use cached value or default
    if (existing && typeof existing.isDevShop === "boolean") return existing.isDevShop;
    return false;
  }
  
  const json = (await response.json()) as { 
    data?: { shop?: { plan?: { partnerDevelopment?: boolean; displayName?: string | null } } };
    errors?: Array<{ message: string }>;
  };
  
  // 检查 GraphQL 错误（HTTP 200 但 GraphQL 层面有错误）
  if (json.errors?.length) {
    logger.warn("detectAndPersistDevShop GraphQL errors", {
      shopDomain,
      errors: json.errors.map(e => e.message).join("; "),
    });
    if (existing && typeof existing.isDevShop === "boolean") return existing.isDevShop;
    return false;
  }
  
  const plan = json?.data?.shop?.plan;
  // 优先使用 partnerDevelopment 字段（官方推荐，布尔值更可靠）
  // 回退到 displayName 判断作为兜底
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
  // This handles the case where user uninstalled but subscription is still active on Shopify
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

export const computeIsTestMode = async (shopDomain: string): Promise<boolean> => {
  if (readAppFlags().billingForceTest) return true;
  const state = await getBillingState(shopDomain);
  if (state?.isDevShop) return true;
  return isNonProduction();
};

export const shouldSkipBillingForPath = (pathname: string, isDevShop: boolean): boolean => {
  // 不再因为开发店跳过计费引导：
  // - 开发店也需要走“选择计划/订阅确认”的引导流程
  // - 订阅请求会通过 computeIsTestMode 自动进入 test mode
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

  if (state.lastTrialEndAt && state.lastTrialEndAt.getTime() > Date.now()) {
    const diff = Math.ceil((state.lastTrialEndAt.getTime() - Date.now()) / DAY_IN_MS);
    return Math.max(diff, 0);
  }

  if (state.lastTrialEndAt && state.lastTrialEndAt.getTime() <= Date.now()) {
    return 0;
  }

  if (state.hasEverSubscribed && toPlanId(state.billingPlan) === plan.id) {
    return 0;
  }

  const remainingBudget = Math.max(plan.defaultTrialDays - (state.usedTrialDays || 0), 0);
  // If firstInstalledAt is missing but we have a state record, do NOT reset to full trial.
  // If usedTrialDays is 0 and hasEverSubscribed is true, user has exhausted trial.
  // Only return remaining budget if user hasn't completed a subscription before.
  if (!state.firstInstalledAt) {
    // If user has ever subscribed to this plan, no more trial
    if (state.hasEverSubscribed && toPlanId(state.billingPlan) === plan.id) {
      return 0;
    }
    return remainingBudget;
  }
  return remainingBudget;
};

export const shouldOfferTrial = async (shopDomain: string, planId?: PlanId): Promise<number> => {
  return calculateRemainingTrialDays(shopDomain, planId);
};

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

export type AppSubscriptionReplacementBehavior =
  | "APPLY_IMMEDIATELY"
  | "APPLY_ON_NEXT_BILLING_CYCLE"
  | "STANDARD";

/**
 * 获取当前应用在该店铺的“我方计划”活跃订阅（用于升级/降级替换）
 * Shopify 同一时间只允许一个 app subscription 生效；切换方案应使用 replacementSubscriptionId。
 */
export const getCurrentActiveAppSubscriptionForPlans = async (
  admin: AdminGraphqlClient,
  shopDomain: string,
): Promise<{ id: string; status: string; name: string; plan: PlanConfig } | null> => {
  const sdk = createGraphqlSdk(admin, shopDomain);
  const QUERY = `#graphql
    query ActiveSubscriptionsForReplacement {
      currentAppInstallation {
        activeSubscriptions {
          id
          name
          status
        }
      }
    }
  `;

  const resp = await sdk.request("activeSubscriptionsForReplacement", QUERY, {});
  if (!resp.ok) return null;

  const json = (await resp.json()) as {
    data?: {
      currentAppInstallation?: {
        activeSubscriptions?: { id: string; name: string; status: string }[];
      };
    };
  };

  const subs = json.data?.currentAppInstallation?.activeSubscriptions || [];
  const candidate = subs.find((s) => {
    const p = resolvePlanByShopifyName(s.name);
    return !!p && (s.status === "ACTIVE" || s.status === "PENDING");
  });
  if (!candidate) return null;

  const plan = resolvePlanByShopifyName(candidate.name);
  if (!plan) return null;

  return { id: candidate.id, status: candidate.status, name: candidate.name, plan };
};

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

export const cancelSubscription = async (
  admin: AdminGraphqlClient,
  subscriptionId: string,
  prorate = true,
) => {
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
  replacement?: {
    subscriptionId?: string | null;
    behavior?: AppSubscriptionReplacementBehavior | null;
  },
) => {
  const plan = getPlanConfig(planId);
  if (plan.priceUsd <= 0) {
    throw new Error(`Plan ${planId} does not require a Shopify subscription.`);
  }

  // 兜底：对 dev store 必须使用 test charge，否则在 Shopify approve 时会报
  // “The shop cannot accept the provided charge.”
  // 上层 action 可能因缓存/异常导致 isTest 误判，这里强制再算一次更稳。
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
  // NOTE:
  // Shopify 在 approve 后会跳转回 returnUrl。如果 returnUrl 不带 shop/host，
  // embedded app 的 authenticate.admin() 将无法重新建立 session，最终可能走到 /auth/login（生产环境 404）。
  const returnUrlUrl = new URL("/app/billing/confirm", cfg.server.appUrl);
  returnUrlUrl.searchParams.set("shop", shopDomain);
  if (returnUrlContext?.host) returnUrlUrl.searchParams.set("host", returnUrlContext.host);
  if (returnUrlContext?.embedded) returnUrlUrl.searchParams.set("embedded", returnUrlContext.embedded);
  if (returnUrlContext?.locale) returnUrlUrl.searchParams.set("locale", returnUrlContext.locale);
  const returnUrl = returnUrlUrl.toString();

  // -----------------------------
  // Upgrade/Downgrade handling
  // -----------------------------
  // Shopify 同一时间只允许一个 app subscription 生效。
  // 直接在已有付费订阅上再创建一个新订阅，可能会在 approve 阶段失败（例如 “The shop cannot accept the provided charge.”）。
  // 因此：如果检测到已有我方计划订阅，切换方案时必须传 replacementSubscriptionId。
  let replacementSubscriptionId: string | null = replacement?.subscriptionId ?? null;
  let replacementBehavior: AppSubscriptionReplacementBehavior | null =
    replacement?.behavior ?? null;

  try {
    if (!replacementSubscriptionId) {
      const current = await getCurrentActiveAppSubscriptionForPlans(admin, shopDomain);
      if (current) {
        // 若正在订阅同一个方案，不需要重复创建
        if (current.plan.id === planId) {
          logger.info("[billing] Subscription request skipped (already on plan)", {
            shopDomain,
            planId,
            currentSubscriptionId: current.id,
            currentStatus: current.status,
          });
          return null;
        }

        replacementSubscriptionId = current.id;

        // 根据价格判断升级/降级，选择更合理的替换行为
        const isUpgrade = plan.priceUsd >= current.plan.priceUsd;
        replacementBehavior = replacementBehavior ?? (isUpgrade ? "APPLY_IMMEDIATELY" : "STANDARD");

        // 有旧订阅时不应再次发放 trial
        trialDays = 0;
      }
    } else {
      // 如果外部显式传了 replacementSubscriptionId，也禁止再发 trial
      trialDays = 0;
      replacementBehavior = replacementBehavior ?? "APPLY_IMMEDIATELY";
    }
  } catch (e) {
    // 兜底：替换检测失败时仍可尝试创建（不阻断），但记录日志方便排查
    logger.warn("[billing] Failed to detect current subscription for replacement", {
      shopDomain,
      planId,
      error: (e as Error).message,
    });
  }

  const MUTATION = `#graphql
    mutation AppSubscriptionCreate(
      $name: String!,
      $lineItems: [AppSubscriptionLineItemInput!]!,
      $returnUrl: URL!,
      $test: Boolean,
      $trialDays: Int,
      $replacementSubscriptionId: ID,
      $replacementBehavior: AppSubscriptionReplacementBehavior
    ) {
      appSubscriptionCreate(
        name: $name,
        lineItems: $lineItems,
        returnUrl: $returnUrl,
        test: $test,
        trialDays: $trialDays,
        replacementSubscriptionId: $replacementSubscriptionId,
        replacementBehavior: $replacementBehavior
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
    replacementSubscriptionId,
    replacementBehavior,
  });

  if (!resp.ok) {
    throw new Error("Failed to create subscription request");
  }

  type CreateSubscriptionResponse = {
    data?: {
      appSubscriptionCreate?: {
        userErrors?: UserError[];
        confirmationUrl?: string;
        appSubscription?: { id: string };
      };
    };
  };

  const json = (await resp.json()) as CreateSubscriptionResponse;
  const errors = json.data?.appSubscriptionCreate?.userErrors || [];
  if (errors.length > 0) {
    throw new Error(errors.map((e) => e.message).join(", "));
  }

  return json.data?.appSubscriptionCreate?.confirmationUrl;
};

export const ensureBilling = async (
  _admin: AdminGraphqlClient,
  _shopDomain: string,
  _request: Request,
): Promise<void> => {
    // Legacy ensure billing - might not be needed with new flow, 
    // but kept for backward compatibility if needed.
    // In new flow, we don't force billing on every request, we check state.
  return;
};
