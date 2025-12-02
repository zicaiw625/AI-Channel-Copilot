import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { requireEnv, isProduction } from "./lib/env.server";
import { runStartupSelfCheck } from "./lib/selfcheck.server";

const apiKey = requireEnv("SHOPIFY_API_KEY");
const apiSecretKey = requireEnv("SHOPIFY_API_SECRET");
const appUrl = requireEnv("SHOPIFY_APP_URL");
const scopes = requireEnv("SCOPES")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

export const MONTHLY_PLAN = "AI Channel Copilot Basic" as const;
export const BILLING_PLAN = MONTHLY_PLAN;
const getBillingInterval = (value: string): BillingInterval.Annual | BillingInterval.Every30Days => {
  switch (value) {
    case "ANNUAL":
      return BillingInterval.Annual;
    case "EVERY_30_DAYS":
    default:
      return BillingInterval.Every30Days;
  }
};
const readBillingConfig = () => {
  const amount = Number(process.env.BILLING_PRICE || "5");
  const currencyCode = (process.env.BILLING_CURRENCY || "USD").toUpperCase();
  const trialDays = Number(process.env.BILLING_TRIAL_DAYS || "7");
  const intervalEnv = (process.env.BILLING_INTERVAL || "EVERY_30_DAYS").toUpperCase();
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
