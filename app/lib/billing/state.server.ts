/**
 * Billing State Management
 * 管理店铺的计费状态持久化和读写
 */

import prisma from "../../db.server";
import { isSchemaMissing, isIgnorableMigrationError, isInitializationError } from "../prismaErrors";
import { logger } from "../logger.server";
import { getPlanConfig, type PlanConfig, type PlanId } from "./plans";

// ============================================================================
// Types
// ============================================================================

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

// ============================================================================
// Constants
// ============================================================================

export const DAY_IN_MS = 24 * 60 * 60 * 1000;

/**
 * Shopify 店铺域名格式正则
 * 有效格式: xxx.myshopify.com 或 xxx-xxx.myshopify.com
 */
const SHOP_DOMAIN_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;

// ============================================================================
// Validation
// ============================================================================

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
export const validateShopDomain = (shopDomain: string, context: string): string | null => {
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

// ============================================================================
// Internal Helpers
// ============================================================================

export const toPlanId = (raw?: string | null): PlanId | null => {
  if (raw === "free" || raw === "pro" || raw === "growth") return raw;
  return null;
};

export const planStateKey = (planId: PlanId, suffix: "TRIALING" | "ACTIVE" | "EXPIRED" | "CANCELLED" | "NO_PLAN") =>
  `${planId.toUpperCase()}_${suffix}`;

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

// ============================================================================
// State CRUD Operations
// ============================================================================

export const getBillingState = async (shopDomain: string): Promise<BillingState | null> => {
  // 验证 shopDomain 格式
  const validDomain = validateShopDomain(shopDomain, "getBillingState");
  if (!validDomain) return null;
  
  try {
    const record = await prisma.shopBillingState.findUnique({
      where: { shopDomain_platform: { shopDomain, platform: "shopify" } },
    });
    return record ? recordToBillingState(shopDomain, record) : null;
  } catch (error) {
    if (isSchemaMissing(error) || isInitializationError(error)) return null;
    throw error;
  }
};

export const upsertBillingState = async (
  shopDomain: string,
  updates: Partial<BillingState>,
): Promise<BillingState> => {
  // 验证 shopDomain 格式
  const validDomain = validateShopDomain(shopDomain, "upsertBillingState");
  if (!validDomain) {
    throw new Error(`Invalid shop domain: ${shopDomain?.slice(0, 50) || "(empty)"}`);
  }
  
  // 重要：不要给 isDevShop 和 hasEverSubscribed 设置默认值 (如 ?? false)
  // 因为调用方可能只想更新部分字段，如果设为 false 会覆盖数据库中的正确值
  const payload: BillingStatePayload = {
    isDevShop: updates.isDevShop,
    billingPlan: updates.billingPlan,
    billingState: updates.billingState,
    firstInstalledAt: updates.firstInstalledAt,
    usedTrialDays: updates.usedTrialDays,
    hasEverSubscribed: updates.hasEverSubscribed,
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

  // 创建新记录时需要提供默认值
  const createData = {
    shopDomain, 
    platform: "shopify", 
    ...cleanedPayload,
    isDevShop: cleanedPayload.isDevShop ?? false,
    billingPlan: cleanedPayload.billingPlan || updates.billingPlan || "NO_PLAN",
    billingState: cleanedPayload.billingState || updates.billingState || "NO_PLAN",
    usedTrialDays: cleanedPayload.usedTrialDays ?? updates.usedTrialDays ?? 0,
    hasEverSubscribed: cleanedPayload.hasEverSubscribed ?? false,
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

// ============================================================================
// Trial Management
// ============================================================================

export const computeIncrementalTrialUsage = (state: BillingState, plan: PlanConfig, asOf: Date): number => {
  if (!plan.trialSupported || !state.lastTrialStartAt) return 0;
  const start = state.lastTrialStartAt.getTime();
  const end =
    state.lastTrialEndAt?.getTime() ?? start + plan.defaultTrialDays * DAY_IN_MS;
  const windowEnd = Math.min(end, asOf.getTime());
  if (windowEnd <= start) return 0;
  // 使用 Math.floor 而非 Math.ceil，避免在边界情况下多算一天
  const diff = Math.floor((windowEnd - start) / DAY_IN_MS);
  return Math.min(plan.defaultTrialDays, Math.max(diff, 0));
};

export const applyTrialConsumption = async (
  shopDomain: string,
  state: BillingState,
  plan: PlanConfig,
  asOf = new Date(),
): Promise<void> => {
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

// ============================================================================
// State Transition Functions
// ============================================================================

export const activateFreePlan = async (shopDomain: string): Promise<void> => {
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
): Promise<void> => {
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
): Promise<void> => {
  const plan = getPlanConfig(planId);
  const state = await getBillingState(shopDomain);
  if (state) {
    await applyTrialConsumption(shopDomain, state, plan);
  }
  // 当变成正式付费状态时，清除试用相关字段
  await upsertBillingState(shopDomain, {
    billingPlan: planId,
    billingState: planStateKey(planId, "ACTIVE"),
    lastSubscriptionStatus: status,
    hasEverSubscribed: true,
    lastTrialStartAt: null,
    lastTrialEndAt: null,
  });
};

export const setSubscriptionExpiredState = async (
  shopDomain: string,
  planId: PlanId,
  status = "EXPIRED",
): Promise<void> => {
  const plan = getPlanConfig(planId);
  const state = await getBillingState(shopDomain);
  if (state) {
    await applyTrialConsumption(shopDomain, state, plan);
  }
  // 订阅过期时清除试用状态
  await upsertBillingState(shopDomain, {
    billingPlan: planId,
    billingState: "EXPIRED_NO_SUBSCRIPTION",
    lastSubscriptionStatus: status,
    lastTrialStartAt: null,
    lastTrialEndAt: null,
  });
};

export const markShopUninstalled = async (shopDomain: string): Promise<void> => {
  await upsertBillingState(shopDomain, {
    billingState: "CANCELLED",
    lastUninstalledAt: new Date(),
  });
};
