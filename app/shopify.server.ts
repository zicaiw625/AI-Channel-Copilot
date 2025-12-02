import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { requireEnv } from "./lib/env.server";
import { runStartupSelfCheck } from "./lib/selfcheck.server";

const apiKey = requireEnv("SHOPIFY_API_KEY");
const apiSecretKey = requireEnv("SHOPIFY_API_SECRET");
const appUrl = requireEnv("SHOPIFY_APP_URL");
const scopes = requireEnv("SCOPES")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

export const BILLING_PLAN = requireEnv("BILLING_PLAN_NAME");
const billingAmount = Number(process.env.BILLING_PRICE || "5");
const billingCurrencyCode = (process.env.BILLING_CURRENCY || "USD").toUpperCase();
const billingTrialDays = Number(process.env.BILLING_TRIAL_DAYS || "7");
const billingIntervalEnv = (process.env.BILLING_INTERVAL || "EVERY_30_DAYS").toUpperCase();
const getBillingInterval = (value: string): BillingInterval => {
  switch (value) {
    case "ANNUAL":
      return BillingInterval.Annual;
    case "EVERY_30_DAYS":
    default:
      return BillingInterval.Every30Days;
  }
};
const billingInterval = getBillingInterval(billingIntervalEnv);

const appApiVersion = ApiVersion.July24;

const shopify = shopifyApp({
  apiKey,
  apiSecretKey,
  apiVersion: appApiVersion,
  scopes,
  appUrl,
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  billing: ({
    [BILLING_PLAN]: {
      amount: billingAmount,
      currencyCode: billingCurrencyCode as any,
      interval: billingInterval,
      trialDays: billingTrialDays,
    },
  } as any),
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

runStartupSelfCheck();

export default shopify;
export const apiVersion = appApiVersion;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
