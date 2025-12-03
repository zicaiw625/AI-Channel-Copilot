import prisma from "../db.server";
import { isNonProduction, requireEnv } from "./env.server";
import { isSchemaMissing, isIgnorableMigrationError } from "./prismaErrors";
import { createGraphqlSdk, type AdminGraphqlClient } from "./graphqlSdk.server";
import {
  PRIMARY_BILLABLE_PLAN_ID,
  getPlanConfig,
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
    if (isSchemaMissing(error)) return null;
    throw error;
  }
};

export const upsertBillingState = async (
  shopDomain: string,
  updates: Partial<BillingState>,
): Promise<BillingState> => {
  const payload = {
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
  
  // Clean undefined values
  Object.keys(payload).forEach(key => {
    if ((payload as any)[key] === undefined) {
      delete (payload as any)[key];
    }
  });

  try {
    const record = await prisma.shopBillingState.upsert({
      where: { shopDomain_platform: { shopDomain, platform: "shopify" } },
      update: payload,
      create: { 
        shopDomain, 
        platform: "shopify", 
        // Set defaults for create
        billingPlan: updates.billingPlan || "NO_PLAN",
        billingState: updates.billingState || "NO_PLAN",
        usedTrialDays: updates.usedTrialDays || 0,
        ...payload 
      },
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
    if (!isIgnorableMigrationError(error)) throw error;
    const existing = await prisma.shopBillingState.findFirst({ where: { shopDomain } });
    if (existing) {
      const updated = await prisma.shopBillingState.update({
        where: { id: existing.id },
        data: payload,
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
    const created = await prisma.shopBillingState.create({
      data: { 
        shopDomain, 
        platform: "shopify", 
        billingPlan: updates.billingPlan || "NO_PLAN",
        billingState: updates.billingState || "NO_PLAN",
        usedTrialDays: updates.usedTrialDays || 0,
        ...payload 
      },
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

export const detectAndPersistDevShop = async (
  admin: AdminGraphqlClient | null,
  shopDomain: string,
): Promise<boolean> => {
  const existing = await getBillingState(shopDomain);
  
  // Bug 1 Fix: Always check plan if admin is available, do not rely on cached 'firstInstalledAt' check to skip
  if (!admin) {
      if (existing && typeof existing.isDevShop === "boolean") return existing.isDevShop;
      // Default to false if we can't check
      return false;
  }
  
  // Initialize firstInstalledAt if missing
  // Note: We do not upsert here to avoid redundant DB writes if the subsequent GraphQL call succeeds.
  // The final upsert updates both isDevShop and firstInstalledAt (via updates construction below).
  // If GraphQL fails and we return false, we accept firstInstalledAt isn't set yet.

  const sdk = createGraphqlSdk(admin, shopDomain);
  const query = `#graphql
    query ShopPlanForBilling {
      shop { plan { displayName } }
    }
  `;
  const response = await sdk.request("shopPlan", query, {});
  if (!response.ok) return false;
  const json = (await response.json()) as { data?: { shop?: { plan?: { displayName?: string | null } } } };
  const planName = json?.data?.shop?.plan?.displayName?.toLowerCase() || "";
  const isDev = planName.includes("development") || planName.includes("trial") || planName.includes("affiliate");
  
  const updates: Partial<BillingState> = { isDevShop: isDev };
  if (!existing?.firstInstalledAt) {
      updates.firstInstalledAt = new Date();
  }
  if (existing?.lastUninstalledAt) {
    const reinstalledAt = new Date();
    if (!existing.lastReinstalledAt || existing.lastReinstalledAt < existing.lastUninstalledAt) {
      updates.lastReinstalledAt = reinstalledAt;
    }
  }
  
  const state = await upsertBillingState(shopDomain, updates);
  return state.isDevShop;
};

export const computeIsTestMode = async (shopDomain: string): Promise<boolean> => {
  if (process.env.BILLING_FORCE_TEST === "true") return true;
  const state = await getBillingState(shopDomain);
  if (state?.isDevShop) return true;
  return isNonProduction();
};

export const shouldSkipBillingForPath = (pathname: string, isDevShop: boolean): boolean => {
  if (isDevShop) return true;
  const path = pathname.toLowerCase();
  if (path.includes("/webhooks/")) return true;
  if (path.includes("/public") || path.endsWith(".css") || path.endsWith(".js")) return true;
  if (path.includes("/app/onboarding") || path.includes("/app/billing")) return true;
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
  if (!state.firstInstalledAt) return remainingBudget || plan.defaultTrialDays;
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
): Promise<{ id: string; name: string; status: string | null; trialEnd: Date | null } | null> => {
  const sdk = createGraphqlSdk(admin);
  const QUERY = `#graphql
    query ActiveSubscriptionDetails {
      currentAppInstallation {
        activeSubscriptions { id name status trialEnd }
      }
    }
  `;
  const resp = await sdk.request("activeSubscriptionDetails", QUERY, {});
  if (!resp.ok) return null;
  const json = (await resp.json()) as {
    data?: { currentAppInstallation?: { activeSubscriptions?: { id: string; name: string; status: string; trialEnd?: string | null }[] } };
  };
  const subs = json.data?.currentAppInstallation?.activeSubscriptions || [];
  const sub = subs.find((s) => s.name === planName) || null;
  if (!sub) return null;
  const trialEnd = sub.trialEnd ? new Date(sub.trialEnd) : null;
  return { id: sub.id, name: sub.name, status: sub.status || null, trialEnd };
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
  const json = (await resp.json()) as any;
  const errors = json.data?.appSubscriptionCancel?.userErrors || [];
  if (errors.length > 0) {
    throw new Error(errors.map((e: any) => e.message).join(", "));
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

  const amount = plan.priceUsd;
  const currencyCode = (process.env.BILLING_CURRENCY || "USD").toUpperCase();
  const intervalEnv = (process.env.BILLING_INTERVAL || plan.interval).toUpperCase();
  const interval = intervalEnv === "ANNUAL" ? "ANNUAL" : "EVERY_30_DAYS";
  const returnUrl = new URL("/app/billing/confirm", requireEnv("SHOPIFY_APP_URL")).toString();

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
  const sdk = createGraphqlSdk(admin);
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

  const json = (await resp.json()) as any;
  const errors = json.data?.appSubscriptionCreate?.userErrors || [];
  if (errors.length > 0) {
    throw new Error(errors.map((e: any) => e.message).join(", "));
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
