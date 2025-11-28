import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { requireEnv } from "./lib/env.server";

const apiKey = requireEnv("SHOPIFY_API_KEY");
const apiSecretKey = requireEnv("SHOPIFY_API_SECRET");
const appUrl = requireEnv("SHOPIFY_APP_URL");
const scopes = requireEnv("SCOPES")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

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
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = appApiVersion;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
