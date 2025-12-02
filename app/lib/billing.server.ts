import prisma from "../db.server";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { isNonProduction, requireEnv } from "./env.server";
import { createGraphqlSdk, type AdminGraphqlClient } from "./graphqlSdk.server";

const tableMissing = (error: unknown) =>
  error instanceof PrismaClientKnownRequestError && error.code === "P2021";
const columnMissing = (error: unknown) =>
  error instanceof PrismaClientKnownRequestError && error.code === "P2022";
const notFound = (error: unknown) =>
  error instanceof PrismaClientKnownRequestError && error.code === "P2025";

export type BillingState = {
  shopDomain: string;
  isDevShop: boolean;
  hasEverSubscribed: boolean;
  lastSubscriptionStatus?: string | null;
  lastTrialStartAt?: Date | null;
  lastTrialEndAt?: Date | null;
  lastCheckedAt?: Date | null;
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
        hasEverSubscribed: record.hasEverSubscribed,
        lastSubscriptionStatus: record.lastSubscriptionStatus,
        lastTrialStartAt: record.lastTrialStartAt || null,
        lastTrialEndAt: record.lastTrialEndAt || null,
        lastCheckedAt: record.lastCheckedAt || null,
      }
      : null;
  } catch (error) {
    if (tableMissing(error) || columnMissing(error)) return null;
    throw error;
  }
};

export const upsertBillingState = async (
  shopDomain: string,
  updates: Partial<BillingState>,
): Promise<BillingState> => {
  const payload = {
    isDevShop: updates.isDevShop ?? false,
    hasEverSubscribed: updates.hasEverSubscribed ?? false,
    lastSubscriptionStatus: updates.lastSubscriptionStatus,
    lastTrialStartAt: updates.lastTrialStartAt || null,
    lastTrialEndAt: updates.lastTrialEndAt || null,
    lastCheckedAt: updates.lastCheckedAt || new Date(),
  };
  try {
    const record = await prisma.shopBillingState.upsert({
      where: { shopDomain_platform: { shopDomain, platform: "shopify" } },
      update: payload,
      create: { shopDomain, platform: "shopify", ...payload },
    });
    return {
      shopDomain,
      isDevShop: record.isDevShop,
      hasEverSubscribed: record.hasEverSubscribed,
      lastSubscriptionStatus: record.lastSubscriptionStatus,
      lastTrialStartAt: record.lastTrialStartAt || null,
      lastTrialEndAt: record.lastTrialEndAt || null,
      lastCheckedAt: record.lastCheckedAt || null,
    };
  } catch (error) {
    if (!(tableMissing(error) || columnMissing(error) || notFound(error))) throw error;
    const existing = await prisma.shopBillingState.findFirst({ where: { shopDomain } });
    if (existing) {
      const updated = await prisma.shopBillingState.update({
        where: { id: existing.id },
        data: payload,
      });
      return {
        shopDomain,
        isDevShop: updated.isDevShop,
        hasEverSubscribed: updated.hasEverSubscribed,
        lastSubscriptionStatus: updated.lastSubscriptionStatus,
        lastTrialStartAt: updated.lastTrialStartAt || null,
        lastTrialEndAt: updated.lastTrialEndAt || null,
        lastCheckedAt: updated.lastCheckedAt || null,
      };
    }
    const created = await prisma.shopBillingState.create({
      data: { shopDomain, platform: "shopify", ...payload },
    });
    return {
      shopDomain,
      isDevShop: created.isDevShop,
      hasEverSubscribed: created.hasEverSubscribed,
      lastSubscriptionStatus: created.lastSubscriptionStatus,
      lastTrialStartAt: created.lastTrialStartAt || null,
      lastTrialEndAt: created.lastTrialEndAt || null,
      lastCheckedAt: created.lastCheckedAt || null,
    };
  }
};

export const detectAndPersistDevShop = async (
  admin: AdminGraphqlClient | null,
  shopDomain: string,
): Promise<boolean> => {
  const existing = await getBillingState(shopDomain);
  if (existing && typeof existing.isDevShop === "boolean") return existing.isDevShop;
  if (!admin) return false;
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
  const isDev = planName.includes("development") || planName.includes("trial");
  const state = await upsertBillingState(shopDomain, { isDevShop: isDev });
  return state.isDevShop;
};

export const computeIsTestMode = async (shopDomain: string): Promise<boolean> => {
  if (process.env.BILLING_FORCE_TEST === "true") return true;
  const state = await getBillingState(shopDomain);
  if (state?.isDevShop) return true;
  return isNonProduction();
};

export const shouldSkipBillingForPath = (pathname: string, isDevShop: boolean): boolean => {
  if (process.env.ENABLE_BILLING !== "true") return true;
  if (isNonProduction()) return true;
  if (isDevShop) return true;
  const path = pathname.toLowerCase();
  if (path.includes("/webhooks/")) return true;
  if (path.includes("/public") || path.endsWith(".css") || path.endsWith(".js")) return true;
  if (path.includes("/app/onboarding") || path.includes("/app/billing")) return true;
  return false;
};

export const markSubscriptionCheck = async (
  shopDomain: string,
  status: string,
  trialStart?: Date | null,
  trialEnd?: Date | null,
  hasEverSubscribed?: boolean,
) => {
  await upsertBillingState(shopDomain, {
    lastSubscriptionStatus: status,
    lastTrialStartAt: trialStart || undefined,
    lastTrialEndAt: trialEnd || undefined,
    hasEverSubscribed: hasEverSubscribed ?? false,
    lastCheckedAt: new Date(),
  });
};

export const getTrialRemainingDays = async (shopDomain: string): Promise<number | null> => {
  const state = await getBillingState(shopDomain);
  if (!state?.lastTrialEndAt) return null;
  const now = Date.now();
  const end = state.lastTrialEndAt.getTime();
  const diff = Math.ceil((end - now) / (24 * 60 * 60 * 1000));
  return Math.max(diff, 0);
};

export const shouldOfferTrial = async (shopDomain: string): Promise<number> => {
  const state = await getBillingState(shopDomain);
  const baseTrial = Number(process.env.BILLING_TRIAL_DAYS || "7");
  if (state?.hasEverSubscribed) return 0;
  return Math.max(0, baseTrial);
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

export const ensureBilling = async (
  admin: AdminGraphqlClient,
  shopDomain: string,
  request: Request,
): Promise<void> => {
  const plan = (process.env.BILLING_PLAN_NAME || "AI Channel Copilot Basic").trim();
  const ok = await hasActiveSubscription(admin, plan);
  if (ok) return;
  const amount = Number(process.env.BILLING_PRICE || "5");
  const currencyCode = (process.env.BILLING_CURRENCY || "USD").toUpperCase();
  const intervalEnv = (process.env.BILLING_INTERVAL || "EVERY_30_DAYS").toUpperCase();
  const interval = intervalEnv === "ANNUAL" ? "ANNUAL" : "EVERY_30_DAYS";
  const trialDays = Number(process.env.BILLING_TRIAL_DAYS || "7");
  const returnUrl = new URL("/app/billing/confirm", requireEnv("SHOPIFY_APP_URL")).toString();
  const MUTATION = `#graphql
    mutation AppSubscriptionCreate($name: String!, $amount: Float!, $currency: CurrencyCode!, $interval: BillingInterval!, $trialDays: Int, $returnUrl: URL!) {
      appSubscriptionCreate(
        name: $name,
        lineItems: [{ amount: $amount, currencyCode: $currency, interval: $interval }],
        trialDays: $trialDays,
        returnUrl: $returnUrl
      ) {
        confirmationUrl
      }
    }
  `;
  const sdk = createGraphqlSdk(admin);
  try {
    const resp = await sdk.request("createSubscription", MUTATION, {
      name: plan,
      amount,
      currency: currencyCode,
      interval,
      trialDays,
      returnUrl,
    });
    if (!resp.ok) return;
    const json = (await resp.json()) as { data?: { appSubscriptionCreate?: { confirmationUrl?: string } } };
    const confirmationUrl = json.data?.appSubscriptionCreate?.confirmationUrl;
    if (confirmationUrl) {
      throw new Response(null, { status: 302, headers: { Location: confirmationUrl } });
    }
  } catch (e) {
    if (e instanceof Response) throw e;
    return;
  }
};
