/**
 * 备用 Admin Client 创建器
 * 当 Shopify SDK 的 unauthenticated.admin() 失败时使用
 */

import prisma from "../db.server";
import { logger } from "./logger.server";
import { apiVersion } from "../shopify.server";

export type AdminGraphqlClient = {
  graphql: (
    query: string,
    options: { variables?: Record<string, unknown> }
  ) => Promise<Response>;
};

/**
 * 从数据库获取 offline session 并创建 admin client
 * 这是 unauthenticated.admin() 的备用方案
 */
export const createAdminClientFromSession = async (
  shopDomain: string
): Promise<AdminGraphqlClient | null> => {
  if (!shopDomain) {
    logger.warn("[adminClient] Missing shop domain");
    return null;
  }

  try {
    // 查找 offline session
    const session = await prisma.session.findFirst({
      where: {
        shop: shopDomain,
        isOnline: false,
      },
      select: {
        accessToken: true,
        scope: true,
      },
    });

    if (!session) {
      logger.warn("[adminClient] No offline session found", { shopDomain });
      return null;
    }

    if (!session.accessToken) {
      logger.warn("[adminClient] Session has no access token", { shopDomain });
      return null;
    }

    // 创建 GraphQL client
    const graphqlEndpoint = `https://${shopDomain}/admin/api/${apiVersion}/graphql.json`;

    const graphql = async (
      query: string,
      options: { variables?: Record<string, unknown> } = {}
    ): Promise<Response> => {
      const body: Record<string, unknown> = { query };
      if (options.variables) {
        body.variables = options.variables;
      }

      const response = await fetch(graphqlEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": session.accessToken,
        },
        body: JSON.stringify(body),
      });

      return response;
    };

    logger.info("[adminClient] Created admin client from session", {
      shopDomain,
      hasScope: !!session.scope,
    });

    return { graphql };
  } catch (error) {
    logger.error("[adminClient] Failed to create admin client", { shopDomain }, {
      error: (error as Error).message,
    });
    return null;
  }
};

/**
 * 尝试获取 admin client，优先使用 SDK，失败时使用备用方案
 */
export const getAdminClient = async (
  shopDomain: string,
  sdkUnauthenticatedAdmin?: () => Promise<unknown>
): Promise<AdminGraphqlClient | null> => {
  // 1. 尝试使用 Shopify SDK
  if (sdkUnauthenticatedAdmin) {
    try {
      const client = await sdkUnauthenticatedAdmin();
      const hasGraphql = (c: unknown): c is AdminGraphqlClient =>
        typeof c === "object" &&
        c !== null &&
        typeof (c as AdminGraphqlClient).graphql === "function";

      if (hasGraphql(client)) {
        logger.info("[adminClient] Using SDK admin client", { shopDomain });
        return client;
      }
    } catch (error) {
      logger.warn("[adminClient] SDK unauthenticated.admin failed, trying fallback", {
        shopDomain,
      }, { error: (error as Error).message });
    }
  }

  // 2. 使用备用方案
  return createAdminClientFromSession(shopDomain);
};

