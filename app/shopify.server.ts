import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { readCriticalEnv, getAppConfig } from "./lib/env.server";
import { runStartupSelfCheck } from "./lib/selfcheck.server";

const { SHOPIFY_API_KEY: apiKey, SHOPIFY_API_SECRET: apiSecretKey, SHOPIFY_APP_URL: appUrl, SCOPES: scopes } =
  readCriticalEnv();

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

// 使用托管定价 (Managed Pricing) - 不在代码中配置 billing
// 定价计划在 Shopify Partner Dashboard 中配置
// 参考: https://shopify.dev/docs/apps/billing/managed-pricing

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
  // billing 配置已移除 - 使用 Shopify 托管定价
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
