/**
 * Scope 权限检查工具
 * 检测 Session 中的权限是否满足应用需求
 */

import prisma from "../db.server";
import { readCriticalEnv } from "./env.server";
import { logger } from "./logger.server";

// 应用核心功能所需的必需权限
const REQUIRED_SCOPES = ["read_orders"] as const;

export type ScopeCheckResult = {
  hasRequiredScopes: boolean;
  missingScopes: string[];
  sessionScope: string | null;
  requiredScopes: string[];
};

/**
 * 检查店铺 Session 是否拥有所需的权限
 */
export const checkSessionScopes = async (shopDomain: string): Promise<ScopeCheckResult> => {
  const result: ScopeCheckResult = {
    hasRequiredScopes: false,
    missingScopes: [],
    sessionScope: null,
    requiredScopes: [...REQUIRED_SCOPES],
  };

  if (!shopDomain) {
    return result;
  }

  try {
    // 查找 offline session
    const session = await prisma.session.findFirst({
      where: {
        shop: shopDomain,
        isOnline: false,
      },
      select: {
        scope: true,
      },
    });

    if (!session || !session.scope) {
      logger.warn("[scopeCheck] No offline session found", { shopDomain });
      result.missingScopes = [...REQUIRED_SCOPES];
      return result;
    }

    result.sessionScope = session.scope;

    // 解析 session 中的 scope
    const sessionScopes = session.scope
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    // 检查必需权限
    for (const required of REQUIRED_SCOPES) {
      if (!sessionScopes.includes(required.toLowerCase())) {
        result.missingScopes.push(required);
      }
    }

    result.hasRequiredScopes = result.missingScopes.length === 0;

    if (!result.hasRequiredScopes) {
      logger.warn("[scopeCheck] Missing required scopes", {
        shopDomain,
        missing: result.missingScopes,
        sessionScope: session.scope,
      });
    }

    return result;
  } catch (error) {
    logger.error("[scopeCheck] Failed to check scopes", { shopDomain }, { error });
    result.missingScopes = [...REQUIRED_SCOPES];
    return result;
  }
};

/**
 * 获取配置的 SCOPES 列表
 */
export const getConfiguredScopes = (): string[] => {
  try {
    const { SCOPES } = readCriticalEnv();
    return SCOPES;
  } catch {
    return [];
  }
};

/**
 * 生成重新授权 URL
 * 使用 Shopify 的 OAuth 授权流程
 * 
 * 对于嵌入式应用，需要通过 Shopify Admin 的 OAuth 端点来重新授权
 */
export const buildReauthorizeUrl = (shopDomain: string): string => {
  // 使用 Shopify Admin 的标准 OAuth 授权 URL
  // 这会触发完整的 OAuth 流程，包括权限确认页面
  const clientId = process.env.SHOPIFY_API_KEY;
  const redirectUri = `${process.env.SHOPIFY_APP_URL}/auth/callback`;
  const scopes = process.env.SCOPES || "read_orders,read_customers,read_products,write_orders,read_checkouts";
  
  // Shopify OAuth 授权 URL
  return `https://${shopDomain}/admin/oauth/authorize?client_id=${clientId}&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(redirectUri)}`;
};
