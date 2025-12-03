import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { isProduction, readCriticalEnv } from "./lib/env.server";
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

export const MONTHLY_PLAN = resolveBillingPlanName(process.env.BILLING_PLAN_NAME);
export type BillingPlanKey = keyof ShopifyAppConfig["billing"];
export const BILLING_PLAN: BillingPlanKey = MONTHLY_PLAN as BillingPlanKey;

const getBillingInterval = (value: string): BillingInterval.Annual | BillingInterval.Every30Days => {
  switch (value) {
    case "ANNUAL":
      return BillingInterval.Annual;
    case "EVERY_30_DAYS":
      return BillingInterval.Every30Days;
    default:
      if (isProduction()) {
        throw new Error(`Unsupported BILLING_INTERVAL: ${value}`);
      }
      return BillingInterval.Every30Days;
  }
};

const readBillingConfig = () => {
  const amount = Number(process.env.BILLING_PRICE || primaryPlan.priceUsd);
  const currencyCode = (process.env.BILLING_CURRENCY || "USD").toUpperCase();
  const trialDays = Number(process.env.BILLING_TRIAL_DAYS || primaryPlan.defaultTrialDays);
  const intervalEnv = (process.env.BILLING_INTERVAL || primaryPlan.interval).toUpperCase();
  const interval = getBillingInterval(intervalEnv);
  const validCurrency = /^[A-Z]{3}$/.test(currencyCode);
  const validAmount = amount > 0 && Number.isFinite(amount);
  const validTrial = trialDays >= 0 && Number.isInteger(trialDays);

  if (isProduction() && (!validCurrency || !validAmount || !validTrial)) {
    throw new Error("Invalid billing configuration");
  }

  return { amount, currencyCode, interval, trialDays };
};

const billing = readBillingConfig();

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
  ...(process.env.SHOP_CUSTOM_DOMAIN?.trim()
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN.trim()] }
    : {}),
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
