import prisma from "../db.server";
import { isNonProduction, readAppFlags, getAppConfig } from "./env.server";
import { isSchemaMissing, isIgnorableMigrationError, isInitializationError } from "./prismaErrors";
import { createGraphqlSdk, type AdminGraphqlClient } from "./graphqlSdk.server";
import { logger } from "./logger.server";
import {
  PRIMARY_BILLABLE_PLAN_ID,
  getPlanConfig,
  resolvePlanByShopifyName,
  type PlanConfig,
  type PlanId,
} from "./billing/plans";

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
  const diff = Math.ceil((windowEnd - start) / DAY_IN_MS);
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
  if (!shopDomain) return null;
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

export const upsertBillingState = async (
  shopDomain: string,
  updates: Partial<BillingState>,
): Promise<BillingState> => {
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

  try {
    const createData = {
      shopDomain, 
      platform: "shopify", 
      ...cleanedPayload,
      billingPlan: cleanedPayload.billingPlan || updates.billingPlan || "NO_PLAN",
      billingState: cleanedPayload.billingState || updates.billingState || "NO_PLAN",
      usedTrialDays: cleanedPayload.usedTrialDays ?? updates.usedTrialDays ?? 0,
    };
    const record = await prisma.shopBillingState.upsert({
      where: { shopDomain_platform: { shopDomain, platform: "shopify" } },
      update: cleanedPayload,
      create: createData,
    });
    return {
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
    };
  } catch (error) {
    if (!isIgnorableMigrationError(error)) {
      if (isInitializationError(error)) {
        // In test or no-DB environments, skip persistence and return a minimal state
        return {
          shopDomain,
          isDevShop: false,
          billingPlan: updates.billingPlan || "NO_PLAN",
          billingState: updates.billingState || "NO_PLAN",
          firstInstalledAt: null,
          usedTrialDays: updates.usedTrialDays || 0,
          hasEverSubscribed: updates.hasEverSubscribed ?? false,
          lastSubscriptionStatus: updates.lastSubscriptionStatus,
          lastTrialStartAt: updates.lastTrialStartAt || null,
          lastTrialEndAt: updates.lastTrialEndAt || null,
          lastCheckedAt: updates.lastCheckedAt || null,
          lastUninstalledAt: updates.lastUninstalledAt || null,
          lastReinstalledAt: updates.lastReinstalledAt || null,
        };
      }
      throw error;
    }
    const existing = await prisma.shopBillingState.findFirst({ where: { shopDomain, platform: "shopify" } });
    if (existing) {
      const updated = await prisma.shopBillingState.update({
        where: { id: existing.id },
        data: cleanedPayload,
      });
      return {
        shopDomain,
        isDevShop: updated.isDevShop,
        billingPlan: updated.billingPlan,
        billingState: updated.billingState,
        firstInstalledAt: updated.firstInstalledAt,
        usedTrialDays: updated.usedTrialDays,
        hasEverSubscribed: updated.hasEverSubscribed,
        lastSubscriptionStatus: updated.lastSubscriptionStatus,
        lastTrialStartAt: updated.lastTrialStartAt || null,
        lastTrialEndAt: updated.lastTrialEndAt || null,
      lastCheckedAt: updated.lastCheckedAt || null,
      lastUninstalledAt: updated.lastUninstalledAt || null,
      lastReinstalledAt: updated.lastReinstalledAt || null,
      };
    }
    const createPayload = {
      shopDomain, 
      platform: "shopify", 
      ...cleanedPayload,
      billingPlan: cleanedPayload.billingPlan || updates.billingPlan || "NO_PLAN",
      billingState: cleanedPayload.billingState || updates.billingState || "NO_PLAN",
      usedTrialDays: cleanedPayload.usedTrialDays ?? updates.usedTrialDays ?? 0,
    };
    const created = await prisma.shopBillingState.create({
      data: createPayload,
    });
    return {
      shopDomain,
      isDevShop: created.isDevShop,
      billingPlan: created.billingPlan,
      billingState: created.billingState,
      firstInstalledAt: created.firstInstalledAt,
      usedTrialDays: created.usedTrialDays,
      hasEverSubscribed: created.hasEverSubscribed,
      lastSubscriptionStatus: created.lastSubscriptionStatus,
      lastTrialStartAt: created.lastTrialStartAt || null,
      lastTrialEndAt: created.lastTrialEndAt || null,
      lastCheckedAt: created.lastCheckedAt || null,
      lastUninstalledAt: created.lastUninstalledAt || null,
      lastReinstalledAt: created.lastReinstalledAt || null,
    };
  }
};

/**
 * Sync subscription status from Shopify Billing API
 * This is crucial for reinstall scenarios where the subscription may still be active
 */
export const syncSubscriptionFromShopify = async (
  admin: AdminGraphqlClient,
  shopDomain: string,
): Promise<{ synced: boolean; status?: string; planId?: PlanId }> => {
  try {
    const sdk = createGraphqlSdk(admin, shopDomain);
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
    
    const resp = await sdk.request("activeSubscriptionsForSync", QUERY, {});
    if (!resp.ok) {
      logger.warn("[billing] Failed to sync subscription from Shopify", { shopDomain, status: resp.status });
      return { synced: false };
    }
    
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
  } catch (error) {
    logger.error("[billing] Error syncing subscription from Shopify", { shopDomain }, {
      error: (error as Error).message,
    });
    return { synced: false };
  }
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
  const query = `#graphql
    query ShopPlanForBilling {
      shop { plan { displayName } }
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
  const json = (await response.json()) as { data?: { shop?: { plan?: { displayName?: string | null } } } };
  const planName = json?.data?.shop?.plan?.displayName?.toLowerCase() || "";
  const isDev = planName.includes("development") || planName.includes("trial") || planName.includes("affiliate");
  
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
  if (isDevShop) return true;
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
  // Only return the calculated remaining budget.
  if (!state.firstInstalledAt) return remainingBudget;
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
) => {
  const plan = getPlanConfig(planId);
  if (plan.priceUsd <= 0) {
    throw new Error(`Plan ${planId} does not require a Shopify subscription.`);
  }

  const cfg = getAppConfig();
  const amount = plan.priceUsd;
  const currencyCode = cfg.billing.currencyCode;
  const interval = cfg.billing.interval;
  const returnUrl = new URL("/app/billing/confirm", cfg.server.appUrl).toString();

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
    test: isTest,
    trialDays: plan.trialSupported ? Math.max(trialDays, 0) : 0,
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
