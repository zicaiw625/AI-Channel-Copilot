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
 * 移除 JSON 字符串中的注释
 * 支持单行注释 (//) 和多行注释
 * 注意：这是一个简化实现，不处理字符串内的注释字符
 */
function stripJsonComments(jsonString: string): string {
  // 移除多行注释
  let result = jsonString.replace(/\/\*[\s\S]*?\*\//g, "");
  // 移除单行注释（只移除行首或空白后的 //）
  result = result.replace(/^\s*\/\/.*$/gm, "");
  return result;
}

/**
 * 检测产品 Schema App Embed 是否启用
 * 
 * @param admin - Shopify Admin GraphQL 客户端
 * @param shopDomain - 店铺域名（用于日志）
 * @returns 
 *   - true: App Embed 已启用
 *   - false: App Embed 存在但已禁用，或未找到
 *   - null: 无法确定（API 调用失败、权限不足或解析失败）
 */
export async function isProductSchemaEmbedEnabled(
  admin: AdminGraphqlClient,
  shopDomain: string
): Promise<boolean | null> {
  try {
    // Step 1: 获取当前激活主题的 ID
    let themeResponse: Response;
    try {
      themeResponse = await graphqlRequest(
        admin,
        "themes.main",
        MAIN_THEME_ID_QUERY,
        {},
        { shopDomain }
      );
    } catch (error) {
      // graphqlRequest 在权限不足或其他错误时会抛出异常
      const message = (error as Error).message || "";
      if (message.includes("read_themes") || message.includes("Access denied")) {
        logger.info("[themeEmbedStatus] Missing read_themes permission, skipping embed detection", {
          shopDomain,
        });
      } else {
        logger.warn("[themeEmbedStatus] Failed to fetch main theme", {
          shopDomain,
          error: message,
        });
      }
      return null;
    }

    if (!themeResponse.ok) {
      logger.warn("[themeEmbedStatus] Failed to fetch main theme", {
        shopDomain,
        status: themeResponse.status,
      });
      return null;
    }

    const themeJson = await themeResponse.json() as {
      data?: { themes?: { nodes: { id: string; name: string }[] } };
      errors?: Array<{ message: string }>;
    };

    // 检查 GraphQL 错误（即使 HTTP 200，也可能有 GraphQL 错误）
    if (themeJson.errors?.length) {
      const errorMsg = themeJson.errors[0]?.message || "Unknown GraphQL error";
      if (errorMsg.includes("read_themes") || errorMsg.includes("Access denied")) {
        logger.info("[themeEmbedStatus] Missing read_themes permission", { shopDomain });
      } else {
        logger.warn("[themeEmbedStatus] GraphQL error fetching theme", { shopDomain, error: errorMsg });
      }
      return null;
    }

    const themeId = themeJson?.data?.themes?.nodes?.[0]?.id;
    if (!themeId) {
      logger.warn("[themeEmbedStatus] No main theme found", { shopDomain });
      return null;
    }

    // Step 2: 读取主题的 settings_data.json
    let settingsResponse: Response;
    try {
      settingsResponse = await graphqlRequest(
        admin,
        "theme.settings_data",
        SETTINGS_DATA_QUERY,
        { id: themeId },
        { shopDomain }
      );
    } catch (error) {
      logger.warn("[themeEmbedStatus] Failed to fetch settings_data.json", {
        shopDomain,
        themeId,
        error: (error as Error).message,
      });
      return null;
    }

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
      errors?: Array<{ message: string }>;
    };

    // 检查 GraphQL 错误
    if (settingsJson.errors?.length) {
      logger.warn("[themeEmbedStatus] GraphQL error fetching settings_data.json", {
        shopDomain,
        themeId,
        error: settingsJson.errors[0]?.message,
      });
      return null;
    }

    const content = settingsJson?.data?.theme?.files?.nodes?.[0]?.body?.content;
    if (!content) {
      logger.warn("[themeEmbedStatus] settings_data.json content is empty", {
        shopDomain,
        themeId,
      });
      return null;
    }

    // Step 3: 解析 JSON 并查找 app embed block
    // Shopify 的 settings_data.json 可能包含注释，需要先移除
    let settings: SettingsData;
    try {
      const cleanedContent = stripJsonComments(content);
      settings = JSON.parse(cleanedContent);
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
    // Block type 格式: "shopify://apps/{app-handle}/blocks/{block-handle}/{uuid}"
    // 
    // 需要检查多个位置，因为不同主题可能有不同的结构：
    // 1. settings.current.blocks - 大多数主题
    // 2. settings.blocks - 某些旧主题
    // 3. 可能需要递归查找
    const blocks = settings?.current?.blocks ?? settings?.blocks ?? {};
    const entries = Object.values(blocks) as ThemeBlock[];

    // 记录所有 block types 以便调试
    const allBlockTypes = entries
      .map(b => b.type)
      .filter((t): t is string => typeof t === "string");
    
    logger.info("[themeEmbedStatus] Scanning theme blocks", {
      shopDomain,
      themeId,
      blockCount: entries.length,
      blockTypes: allBlockTypes.slice(0, 20), // 只记录前 20 个，避免日志过长
    });

    // 查找我们的 product-schema-embed block
    // 
    // Shopify settings_data.json 中 block type 格式：
    // "shopify://apps/{app-handle}/blocks/{block-handle}/{uuid}"
    // 
    // 精确匹配 "/blocks/product-schema-embed/" 以避免误匹配其他 app 的 schema block
    // 例如：shopify://apps/ai-channel-copilot/blocks/product-schema-embed/abc123
    const BLOCK_HANDLE = "product-schema-embed";
    const BLOCK_PATTERN = `/blocks/${BLOCK_HANDLE}/`;
    
    const hit = entries.find(b => {
      if (typeof b.type !== "string") return false;
      // 精确匹配我们的 block handle
      return b.type.includes(BLOCK_PATTERN);
    });

    if (!hit) {
      logger.info("[themeEmbedStatus] Product schema embed block not found", {
        shopDomain,
        themeId,
        blockCount: entries.length,
        // 记录所有可能相关的 block（包含 schema 或 embed 关键字）以便调试
        relatedBlocks: allBlockTypes.filter(t => 
          t.toLowerCase().includes("schema") || 
          t.toLowerCase().includes("embed") ||
          t.toLowerCase().includes("json-ld") ||
          t.toLowerCase().includes("product")
        ),
      });
      return false;
    }

    // 检查 block 是否被禁用
    // 1. block.disabled !== true：block 本身未被禁用
    // 2. block.settings.enable_product_schema !== false：block 内部的开关未被关闭
    //    注意：如果 settings 不存在或 enable_product_schema 不存在，默认视为启用
    //    因为 liquid 模板中 default 值是 true
    const isBlockDisabled = hit.disabled === true;
    const isSettingDisabled = hit.settings?.enable_product_schema === false;
    const isEnabled = !isBlockDisabled && !isSettingDisabled;
    
    logger.info("[themeEmbedStatus] Product schema embed status", {
      shopDomain,
      themeId,
      isEnabled,
      blockType: hit.type,
      blockDisabled: isBlockDisabled,
      settingDisabled: isSettingDisabled,
      settings: hit.settings,
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
 * 
 * 支持两种模式：
 * 1. 带 activateAppId：直接触发 embed 激活流程（推荐）
 * 2. 仅 context=apps：打开 App embeds 面板（fallback）
 * 
 * @param shopDomain - 店铺域名
 * @param options - 配置选项
 * @param options.themeId - 主题 ID（可选，不提供则使用当前主题）
 * @param options.apiKey - App 的 API Key（用于生成 activateAppId 链接）
 * @param options.blockHandle - Embed block handle（默认 product-schema-embed）
 * @returns Deep link URL
 * 
 * @see https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/configuration
 */
export function getAppEmbedDeepLink(
  shopDomain: string, 
  options: {
    themeId?: string;
    apiKey?: string;
    blockHandle?: string;
  } = {}
): string {
  const { themeId, apiKey, blockHandle = "product-schema-embed" } = options;
  
  // 如果没有 themeId，使用 current 指代当前激活主题
  const themeParam = themeId 
    ? themeId.replace(/^gid:\/\/shopify\/OnlineStoreTheme\//, "") 
    : "current";
  
  // 基础 URL
  const baseUrl = `https://${shopDomain}/admin/themes/${themeParam}/editor`;
  
  // 构建查询参数
  const params = new URLSearchParams();
  params.set("context", "apps");
  
  // 如果提供了 apiKey，添加 activateAppId 参数以直接触发激活流程
  // 格式: activateAppId={api_key}/{block_handle}
  // 同时添加 template=product 以在产品页上下文中预览
  if (apiKey) {
    params.set("template", "product");
    params.set("activateAppId", `${apiKey}/${blockHandle}`);
  }
  
  return `${baseUrl}?${params.toString()}`;
}

/**
 * 获取主题编辑器的手动路径说明
 * 
 * @param _language - 语言设置（预留参数，用于未来根据语言返回不同格式）
 * @returns 手动路径说明（双语）
 */
export function getAppEmbedManualPath(_language: string = "中文"): {
  en: string;
  zh: string;
} {
  return {
    en: "Online Store → Themes → Customize → App embeds → Enable 'Product Schema (JSON-LD)'",
    zh: "在线商店 → 主题 → 自定义 → App embeds → 开启「Product Schema (JSON-LD)」",
  };
}
