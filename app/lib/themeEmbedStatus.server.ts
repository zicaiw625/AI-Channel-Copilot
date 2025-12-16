/**
 * Theme Embed Status Detection
 * 检测 App Embed 是否在当前主题中启用
 */

import { graphqlRequest, type AdminGraphqlClient } from "./graphqlSdk.server";
import { logger } from "./logger.server";

// 获取当前激活主题的 ID
const MAIN_THEME_ID_QUERY = `#graphql
query MainTheme {
  themes(first: 1, roles: [MAIN]) {
    nodes { 
      id 
      name
    }
  }
}`;

// 读取主题的 settings_data.json 文件
const SETTINGS_DATA_QUERY = `#graphql
query ThemeSettingsData($id: ID!) {
  theme(id: $id) {
    files(filenames: ["config/settings_data.json"], first: 1) {
      nodes {
        filename
        body {
          ... on OnlineStoreThemeFileBodyText { 
            content 
          }
        }
      }
    }
  }
}`;

type ThemeBlock = {
  type?: string;
  disabled?: boolean;
  settings?: Record<string, unknown>;
};

type SettingsData = {
  current?: {
    blocks?: Record<string, ThemeBlock>;
  };
  blocks?: Record<string, ThemeBlock>;
};

/**
 * 检测产品 Schema App Embed 是否启用
 * 
 * @param admin - Shopify Admin GraphQL 客户端
 * @param shopDomain - 店铺域名（用于日志）
 * @returns 
 *   - true: App Embed 已启用
 *   - false: App Embed 存在但已禁用，或未找到
 *   - null: 无法确定（API 调用失败或解析失败）
 */
export async function isProductSchemaEmbedEnabled(
  admin: AdminGraphqlClient,
  shopDomain: string
): Promise<boolean | null> {
  try {
    // Step 1: 获取当前激活主题的 ID
    const themeResponse = await graphqlRequest(
      admin,
      "themes.main",
      MAIN_THEME_ID_QUERY,
      {},
      { shopDomain }
    );

    if (!themeResponse.ok) {
      logger.warn("[themeEmbedStatus] Failed to fetch main theme", {
        shopDomain,
        status: themeResponse.status,
      });
      return null;
    }

    const themeJson = await themeResponse.json() as {
      data?: { themes?: { nodes: { id: string; name: string }[] } };
    };

    const themeId = themeJson?.data?.themes?.nodes?.[0]?.id;
    if (!themeId) {
      logger.warn("[themeEmbedStatus] No main theme found", { shopDomain });
      return null;
    }

    // Step 2: 读取主题的 settings_data.json
    const settingsResponse = await graphqlRequest(
      admin,
      "theme.settings_data",
      SETTINGS_DATA_QUERY,
      { id: themeId },
      { shopDomain }
    );

    if (!settingsResponse.ok) {
      logger.warn("[themeEmbedStatus] Failed to fetch settings_data.json", {
        shopDomain,
        themeId,
        status: settingsResponse.status,
      });
      return null;
    }

    const settingsJson = await settingsResponse.json() as {
      data?: {
        theme?: {
          files?: {
            nodes: {
              filename: string;
              body?: { content?: string };
            }[];
          };
        };
      };
    };

    const content = settingsJson?.data?.theme?.files?.nodes?.[0]?.body?.content;
    if (!content) {
      logger.warn("[themeEmbedStatus] settings_data.json content is empty", {
        shopDomain,
        themeId,
      });
      return null;
    }

    // Step 3: 解析 JSON 并查找 app embed block
    let settings: SettingsData;
    try {
      settings = JSON.parse(content);
    } catch (parseError) {
      logger.error("[themeEmbedStatus] Failed to parse settings_data.json", {
        shopDomain,
        themeId,
      }, {
        error: (parseError as Error).message,
      });
      return null;
    }

    // 遍历 blocks，查找包含我们 app embed 的 block
    // Block 文件名: extensions/product-schema/blocks/product-schema-embed.liquid
    // Block type 通常包含: "shopify://apps/{app-handle}/blocks/{block-handle}/{uuid}"
    const blocks = settings?.current?.blocks ?? settings?.blocks ?? {};
    const entries = Object.values(blocks) as ThemeBlock[];

    // 查找我们的 product-schema-embed block
    const hit = entries.find(b => {
      if (typeof b.type !== "string") return false;
      // 匹配 app embed block type，可能包含以下模式之一：
      // - product-schema-embed
      // - product-schema
      // 根据实际的 app handle 和 block handle 进行匹配
      return (
        b.type.includes("product-schema-embed") ||
        b.type.includes("product-schema")
      );
    });

    if (!hit) {
      logger.info("[themeEmbedStatus] Product schema embed block not found", {
        shopDomain,
        themeId,
        blockCount: entries.length,
      });
      return false;
    }

    // 检查 block 是否被禁用
    const isEnabled = hit.disabled !== true;
    
    logger.info("[themeEmbedStatus] Product schema embed status", {
      shopDomain,
      themeId,
      isEnabled,
      blockType: hit.type,
    });

    return isEnabled;
  } catch (error) {
    logger.error("[themeEmbedStatus] Unexpected error checking embed status", {
      shopDomain,
    }, {
      error: (error as Error).message,
    });
    return null;
  }
}

/**
 * 生成 App Embed 启用的 deep link
 * 注意：Deep link 在某些店铺/时段可能不稳定，应该同时提供手动路径作为备选
 * 
 * @param shopDomain - 店铺域名
 * @param themeId - 主题 ID（可选，不提供则使用当前主题）
 * @returns Deep link URL
 */
export function getAppEmbedDeepLink(shopDomain: string, themeId?: string): string {
  // 格式: https://{shop}/admin/themes/{theme_id}/editor?context=apps
  // 如果没有 themeId，使用 current 指代当前激活主题
  const themeParam = themeId ? themeId.replace(/^gid:\/\/shopify\/OnlineStoreTheme\//, "") : "current";
  return `https://${shopDomain}/admin/themes/${themeParam}/editor?context=apps`;
}

/**
 * 获取主题编辑器的手动路径说明
 * 
 * @param language - 语言设置
 * @returns 手动路径说明（双语）
 */
export function getAppEmbedManualPath(language: string = "中文"): {
  en: string;
  zh: string;
} {
  return {
    en: "Online Store → Themes → Customize → App embeds → Enable 'Product Schema (JSON-LD)'",
    zh: "在线商店 → 主题 → 自定义 → App embeds → 开启「Product Schema (JSON-LD)」",
  };
}
