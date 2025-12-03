import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { readCriticalEnv } from "./lib/env.server";
import { runStartupSelfCheck } from "./lib/selfcheck.server";
import { BILLING_PLANS, PRIMARY_BILLABLE_PLAN_ID } from "./lib/billing/plans";

const { SHOPIFY_API_KEY: apiKey, SHOPIFY_API_SECRET: apiSecretKey, SHOPIFY_APP_URL: appUrl, SCOPES: scopes } =
  readCriticalEnv();

const primaryPlan = BILLING_PLANS[PRIMARY_BILLABLE_PLAN_ID];
const resolveBillingPlanName = (planNameEnv?: string | null): string => {
  const resolved = (planNameEnv ?? primaryPlan.shopifyName).trim();
  if (!resolved) {
    throw new Error("BILLING_PLAN_NAME must not be empty");
  }
  return resolved;
};

const parsePositiveNumber = (raw: string, name: string) => {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return parsed;
};

const parseNonNegativeInteger = (raw: string, name: string) => {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
};

const getBillingInterval = (value: string): BillingInterval.Annual | BillingInterval.Every30Days => {
  switch (value) {
    case "ANNUAL":
      return BillingInterval.Annual;
    case "EVERY_30_DAYS":
      return BillingInterval.Every30Days;
    default:
      throw new Error(`Unsupported BILLING_INTERVAL: ${value}`);
  }
};

const readBillingConfig = () => {
  const amount = parsePositiveNumber(String(process.env.BILLING_PRICE ?? primaryPlan.priceUsd), "BILLING_PRICE");
  const currencyCode = (process.env.BILLING_CURRENCY || "USD").toUpperCase();
  const trialDays = parseNonNegativeInteger(
    String(process.env.BILLING_TRIAL_DAYS ?? primaryPlan.defaultTrialDays),
    "BILLING_TRIAL_DAYS",
  );
  const intervalEnv = (process.env.BILLING_INTERVAL || primaryPlan.interval).toUpperCase();
  const interval = getBillingInterval(intervalEnv);

  if (!/^[A-Z]{3}$/.test(currencyCode)) {
    throw new Error("BILLING_CURRENCY must be a three-letter ISO code");
  }

  return { amount, currencyCode, interval, trialDays } as const;
};

const resolveCustomShopDomains = () => {
  const customDomainsEnv = process.env.SHOP_CUSTOM_DOMAIN;
  if (!customDomainsEnv) return [] as string[];

  const domains = customDomainsEnv
    .split(",")
    .map((domain) => domain.trim())
    .filter(Boolean);

  const uniqueDomains = Array.from(new Set(domains));

  if (!uniqueDomains.length) {
    throw new Error("SHOP_CUSTOM_DOMAIN must contain at least one domain when defined");
  }

  return uniqueDomains;
};

const billing = readBillingConfig();
const customShopDomains = resolveCustomShopDomains();
const monthlyPlanName = resolveBillingPlanName(process.env.BILLING_PLAN_NAME);
export const MONTHLY_PLAN = monthlyPlanName;
export type BillingPlanKey = keyof ShopifyAppConfig["billing"];
export const BILLING_PLAN: BillingPlanKey = MONTHLY_PLAN as BillingPlanKey;

const appApiVersion = ApiVersion.October25;

const appConfig = {
  apiKey,
  apiSecretKey,
  apiVersion: appApiVersion,
  scopes,
  appUrl,
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  billing: {
    [MONTHLY_PLAN]: {
      lineItems: [
        {
          amount: billing.amount,
          currencyCode: billing.currencyCode,
          interval: billing.interval,
        },
      ],
      trialDays: billing.trialDays,
    },
  },
  ...(customShopDomains.length ? { customShopDomains } : {}),
};

const shopify = shopifyApp(appConfig);

runStartupSelfCheck();

export default shopify;
export const apiVersion = appApiVersion;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
export type ShopifyAppConfig = typeof appConfig;
