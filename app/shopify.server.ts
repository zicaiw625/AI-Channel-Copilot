import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { readCriticalEnv, getAppConfig } from "./lib/env.server";
import { logger } from "./lib/logger.server";
import { runStartupSelfCheck } from "./lib/selfcheck.server";

const { SHOPIFY_API_KEY: apiKey, SHOPIFY_API_SECRET: apiSecretKey, SHOPIFY_APP_URL: appUrl, SCOPES: scopes } =
  readCriticalEnv();

// 仅在非生产环境输出诊断日志，避免污染生产日志与暴露配置细节
if (process.env.NODE_ENV !== "production") {
  logger.debug("[shopify.server] SCOPES from env", { scopes });
}

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

const appCfg = getAppConfig();
const customShopDomains = resolveCustomShopDomains();
export const MONTHLY_PLAN = appCfg.billing.planName;
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
  // Shopify SDK expects a specific billing type structure with dynamic plan names
  // Using type assertion here as the plan name is determined at runtime from env config
  billing: {
    [MONTHLY_PLAN]: {
      lineItems: [
        {
          amount: appCfg.billing.amount,
          currencyCode: appCfg.billing.currencyCode,
          interval: appCfg.billing.interval === "ANNUAL" ? BillingInterval.Annual : BillingInterval.Every30Days,
        },
      ],
      trialDays: appCfg.billing.trialDays,
    },
  } as Parameters<typeof shopifyApp>[0]["billing"],
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
