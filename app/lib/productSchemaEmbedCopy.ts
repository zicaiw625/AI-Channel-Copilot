/**
 * Product Schema Embed 相关的双语文案
 * 
 * 用于统一 AI Visibility 页面和 Optimization 页面的文案
 * 确保两处的措辞一致，降低维护成本
 */

export type EmbedStatus = "enabled" | "disabled" | "unknown";

export interface EmbedCopy {
  title: { en: string; zh: string };
  description: { en: string; zh: string };
  impact: { en: string; zh: string };
  buttonLabel: { en: string; zh: string };
  estimatedLift: string;
}

/**
 * 根据 embed 状态获取对应的文案
 */
export function getEmbedCopy(status: EmbedStatus): EmbedCopy {
  switch (status) {
    case "enabled":
      return {
        title: {
          en: "Product Schema is Active",
          zh: "Product Schema 已启用",
        },
        description: {
          en: "Your product pages are automatically outputting structured data (JSON-LD) to help AI assistants and search engines understand your products.",
          zh: "您的产品页面正在自动输出结构化数据 (JSON-LD)，帮助 AI 助手和搜索引擎更好地理解您的产品。",
        },
        impact: {
          en: "Schema markup is active and working.",
          zh: "Schema 标记已激活并正常工作。",
        },
        buttonLabel: {
          en: "View Theme Settings",
          zh: "查看主题设置",
        },
        estimatedLift: "Active",
      };

    case "disabled":
      return {
        title: {
          en: "Enable Product Schema App Embed",
          zh: "启用产品 Schema App Embed",
        },
        description: {
          en: "The Product Schema (JSON-LD) app embed is installed but not enabled in your theme. Enable it to add structured data to your product pages.",
          zh: "产品 Schema (JSON-LD) App Embed 已安装但未在主题中启用。启用后可为产品页面添加结构化数据。",
        },
        impact: {
          en: "Schema markup helps AI assistants understand and recommend your products more accurately.",
          zh: "Schema 标记帮助 AI 助手更准确地理解和推荐您的产品。",
        },
        buttonLabel: {
          en: "Enable Product Schema Now",
          zh: "立即启用 Product Schema",
        },
        estimatedLift: "+15-25% AI visibility",
      };

    case "unknown":
    default:
      return {
        title: {
          en: "Check Your Theme Settings",
          zh: "请检查主题设置",
        },
        description: {
          en: "Please verify that the Product Schema (JSON-LD) app embed is enabled in your theme. This adds structured data to your product pages for better AI discoverability.",
          zh: "请确认产品 Schema (JSON-LD) App Embed 已在主题中启用。这将为产品页面添加结构化数据，提升 AI 可发现性。",
        },
        impact: {
          en: "Schema markup helps AI assistants understand and recommend your products more accurately.",
          zh: "Schema 标记帮助 AI 助手更准确地理解和推荐您的产品。",
        },
        buttonLabel: {
          en: "Check Theme Settings",
          zh: "检查主题设置",
        },
        estimatedLift: "+15-25% AI visibility",
      };
  }
}

/**
 * 将 boolean | null 转换为 EmbedStatus
 */
export function toEmbedStatus(embedEnabled: boolean | null): EmbedStatus {
  if (embedEnabled === true) return "enabled";
  if (embedEnabled === false) return "disabled";
  return "unknown";
}

/**
 * 获取手动启用路径的双语文案
 */
export const MANUAL_PATH_COPY = {
  en: "Online Store → Themes → Customize → App embeds → Enable 'Product Schema (JSON-LD)'",
  zh: "在线商店 → 主题 → 自定义 → App embeds → 开启「Product Schema (JSON-LD)」",
} as const;
