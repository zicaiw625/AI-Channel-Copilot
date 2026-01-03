/**
 * AI 优化建议服务
 * 帮助商家提升在 AI 平台中的可见性和转化
 */

import prisma from "../db.server";
import { resolveDateRange, type TimeRangeKey } from "./aiData";
import { fromPrismaAiSource } from "./aiSourceMapper";
import { logger } from "./logger.server";
import type { AdminGraphqlClient } from "./graphqlSdk.server";
import { createGraphqlSdk } from "./graphqlSdk.server";
import { MAX_ORDER_PRODUCTS } from "./constants";
import { isProductSchemaEmbedEnabled, getAppEmbedDeepLink, getAppEmbedManualPath } from "./themeEmbedStatus.server";
import { getEmbedCopy, toEmbedStatus, MANUAL_PATH_COPY } from "./productSchemaEmbedCopy";

// ============================================================================
// Types
// ============================================================================

export type OptimizationCategory = 
  | "schema_markup"      // Schema.org 结构化数据
  | "content_quality"    // 内容质量
  | "faq_coverage"       // FAQ 覆盖
  | "product_info"       // 产品信息完整度
  | "ai_visibility";     // AI 可见性

export type OptimizationPriority = "high" | "medium" | "low";

export interface OptimizationSuggestion {
  id: string;
  category: OptimizationCategory;
  priority: OptimizationPriority;
  title: { en: string; zh: string };
  description: { en: string; zh: string };
  impact: string;
  action: string;
  codeSnippet?: string;
  affectedProducts?: string[];
  estimatedLift?: string;
}

export interface ProductAIPerformance {
  productId: string;
  title: string;
  handle: string;
  url: string;
  aiGMV: number;
  aiOrders: number;
  totalGMV: number;
  totalOrders: number;
  aiShare: number;
  topChannel: string | null;
  hasDescription: boolean;
  descriptionLength: number;
  hasImages: boolean;
  imageCount: number;
  hasSEOTitle: boolean;
  hasSEODescription: boolean;
  schemaMarkupStatus: "complete" | "partial" | "missing";
  suggestedImprovements: string[];
}

export interface AIOptimizationReport {
  generatedAt: string;
  shopDomain: string;
  range: { key: TimeRangeKey; label: string };
  
  // 总览分数 (0-100)
  overallScore: number;
  scoreBreakdown: {
    schemaMarkup: number;
    contentQuality: number;
    faqCoverage: number;
    productCompleteness: number;
  };
  
  // 优化建议列表
  suggestions: OptimizationSuggestion[];
  
  // 产品级分析
  topProducts: ProductAIPerformance[];
  underperformingProducts: ProductAIPerformance[];
  
  // FAQ 建议（基于 AI 订单中的产品）
  suggestedFAQs: {
    question: string;
    suggestedAnswer: string;
    basedOnProduct: string;
  }[];
  
  // llms.txt 增强建议
  llmsEnhancements: {
    currentCoverage: number;
    suggestedAdditions: string[];
    categoryRecommendations: string[];
  };
}

// ============================================================================
// GraphQL Queries
// ============================================================================

const PRODUCT_DETAILS_QUERY = `#graphql
  query ProductsForOptimization($first: Int!, $query: String) {
    products(first: $first, query: $query, sortKey: UPDATED_AT, reverse: true) {
      edges {
        node {
          id
          title
          handle
          description
          descriptionHtml
          onlineStoreUrl
          seo {
            title
            description
          }
          images(first: 5) {
            edges {
              node {
                url
                altText
              }
            }
          }
          variants(first: 1) {
            edges {
              node {
                price
                sku
              }
            }
          }
          priceRange {
            minVariantPrice {
              amount
              currencyCode
            }
          }
          productType
          vendor
          tags
        }
      }
    }
  }
`;

// 获取店铺最新产品（用于没有 AI 订单数据时的评分）
const RECENT_PRODUCTS_QUERY = `#graphql
  query RecentProductsForOptimization($first: Int!) {
    products(first: $first, sortKey: UPDATED_AT, reverse: true, query: "status:active") {
      edges {
        node {
          id
          title
          handle
          description
          descriptionHtml
          onlineStoreUrl
          seo {
            title
            description
          }
          images(first: 5) {
            edges {
              node {
                url
                altText
              }
            }
          }
          variants(first: 1) {
            edges {
              node {
                price
                sku
              }
            }
          }
          priceRange {
            minVariantPrice {
              amount
              currencyCode
            }
          }
          productType
          vendor
          tags
        }
      }
    }
  }
`;

type ProductNode = {
  id: string;
  title: string;
  handle: string;
  description: string | null;
  descriptionHtml: string | null;
  onlineStoreUrl: string | null;
  seo: { title: string | null; description: string | null } | null;
  images: { edges: { node: { url: string; altText: string | null } }[] };
  variants: { edges: { node: { price: string; sku: string | null } }[] };
  priceRange?: {
    minVariantPrice: {
      amount: string;
      currencyCode: string;
    };
  };
  productType: string | null;
  vendor: string | null;
  tags: string[];
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * 货币符号映射表
 */
const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  CNY: "¥",
  CAD: "CA$",
  AUD: "A$",
  HKD: "HK$",
  SGD: "S$",
  KRW: "₩",
  INR: "₹",
  MXN: "MX$",
  BRL: "R$",
  TWD: "NT$",
  THB: "฿",
  VND: "₫",
  MYR: "RM",
  PHP: "₱",
  IDR: "Rp",
};

/**
 * 格式化价格，包含正确的货币符号和千位分隔符
 */
function formatPrice(amount: string | number, currencyCode: string): string {
  const numAmount = typeof amount === "string" ? parseFloat(amount) : amount;
  const symbol = CURRENCY_SYMBOLS[currencyCode] || currencyCode + " ";
  
  // 使用 Intl.NumberFormat 进行本地化格式化
  try {
    const formatted = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(numAmount);
    return `${symbol}${formatted}`;
  } catch {
    // Fallback: 简单格式化
    return `${symbol}${numAmount.toFixed(2)}`;
  }
}

/**
 * 智能截断文本，避免在单词或中文字符中间截断
 * @param text 原始文本
 * @param maxLength 最大长度
 * @param isEnglish 是否为英文环境
 * @returns 截断后的文本
 */
function smartTruncate(text: string, maxLength: number, isEnglish: boolean): string {
  if (!text || text.length <= maxLength) {
    return text;
  }
  
  // 查找截断点
  let truncateAt = maxLength;
  
  if (isEnglish) {
    // 英文：在空格、标点处截断
    const lastSpace = text.lastIndexOf(" ", maxLength);
    const lastPunctuation = Math.max(
      text.lastIndexOf(".", maxLength),
      text.lastIndexOf(",", maxLength),
      text.lastIndexOf("!", maxLength),
      text.lastIndexOf("?", maxLength),
    );
    
    // 优先选择标点位置，其次是空格位置
    if (lastPunctuation > maxLength * 0.6) {
      truncateAt = lastPunctuation + 1;
    } else if (lastSpace > maxLength * 0.6) {
      truncateAt = lastSpace;
    }
  } else {
    // 中文：在标点符号处截断
    const punctuations = ["。", "，", "！", "？", "；", "、", ".", ",", "!", "?"];
    let bestPos = -1;
    
    for (const p of punctuations) {
      const pos = text.lastIndexOf(p, maxLength);
      if (pos > bestPos && pos > maxLength * 0.6) {
        bestPos = pos;
      }
    }
    
    if (bestPos > 0) {
      truncateAt = bestPos + 1;
    }
  }
  
  const truncated = text.slice(0, truncateAt).trim();
  
  // 如果截断后的文本和原文不同，添加省略号
  if (truncated.length < text.length) {
    // 移除末尾的标点（避免 "文字。..." 这种情况）
    const cleanText = truncated.replace(/[.,!?。，！？；、\s]+$/, "");
    return cleanText + "...";
  }
  
  return truncated;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * 获取产品详细信息（用于优化分析）
 * 支持分页获取，避免超过 50 个产品时丢失数据
 */
export async function fetchProductDetails(
  admin: AdminGraphqlClient,
  shopDomain: string,
  productIds: string[],
): Promise<Map<string, ProductNode>> {
  const productMap = new Map<string, ProductNode>();
  
  if (!productIds.length) return productMap;

  const BATCH_SIZE = 50;
  const sdk = createGraphqlSdk(admin, shopDomain);

  // 分批获取产品详情，避免单次请求超过 GraphQL 限制
  for (let i = 0; i < productIds.length; i += BATCH_SIZE) {
    const batchIds = productIds.slice(i, i + BATCH_SIZE);
    
    try {
      // Convert GID format to query format
      const queryStr = batchIds
        .map(id => {
          const numericId = id.replace(/^gid:\/\/shopify\/Product\//, "");
          return `id:${numericId}`;
        })
        .join(" OR ");
      
      const response = await sdk.request(
        "productsForOptimization",
        PRODUCT_DETAILS_QUERY,
        { first: batchIds.length, query: queryStr }
      );
      
      if (!response.ok) {
        logger.warn("[aiOptimization] Failed to fetch products batch", { 
          shopDomain, 
          status: response.status,
          batchIndex: i / BATCH_SIZE,
        });
        continue; // 继续处理下一批，不要因为一批失败就停止
      }
      
      const json = await response.json() as {
        data?: { products?: { edges: { node: ProductNode }[] } };
      };
      
      const products = json.data?.products?.edges || [];
      for (const { node } of products) {
        productMap.set(node.id, node);
      }
    } catch (error) {
      logger.error("[aiOptimization] Error fetching products batch", { 
        shopDomain,
        batchIndex: i / BATCH_SIZE,
      }, {
        error: (error as Error).message,
      });
      // 继续处理下一批
    }
  }
  
  if (productMap.size < productIds.length) {
    logger.info("[aiOptimization] Some products not found", {
      shopDomain,
      requested: productIds.length,
      found: productMap.size,
    });
  }
  
  return productMap;
}

/**
 * 获取店铺最新产品（用于没有 AI 订单数据时的评分）
 */
async function fetchRecentProducts(
  admin: AdminGraphqlClient,
  shopDomain: string,
  limit: number = 20,
): Promise<ProductNode[]> {
  try {
    const sdk = createGraphqlSdk(admin, shopDomain);
    
    const response = await sdk.request(
      "recentProductsForOptimization",
      RECENT_PRODUCTS_QUERY,
      { first: limit }
    );
    
    if (!response.ok) {
      logger.warn("[aiOptimization] Failed to fetch recent products", { shopDomain, status: response.status });
      return [];
    }
    
    const json = await response.json() as {
      data?: { products?: { edges: { node: ProductNode }[] } };
    };
    
    return json.data?.products?.edges.map(e => e.node) || [];
  } catch (error) {
    logger.error("[aiOptimization] Error fetching recent products", { shopDomain }, {
      error: (error as Error).message,
    });
    return [];
  }
}

/**
 * 将 ProductNode 转换为 ProductAIPerformance（用于没有 AI 订单数据时）
 */
function productNodeToPerformance(
  product: ProductNode, 
  shopDomain: string, 
  language: string = "English"
): ProductAIPerformance {
  const description = product.description || "";
  const hasDescription = Boolean(description.trim());
  const descriptionLength = description.length;
  const hasImages = product.images.edges.length > 0;
  const imageCount = product.images.edges.length;
  const hasSEOTitle = Boolean(product.seo?.title);
  const hasSEODescription = Boolean(product.seo?.description);
  
  return {
    productId: product.id,
    title: product.title,
    handle: product.handle,
    url: product.onlineStoreUrl || `https://${shopDomain}/products/${product.handle}`,
    aiGMV: 0,
    aiOrders: 0,
    totalGMV: 0,
    totalOrders: 0,
    aiShare: 0,
    topChannel: null,
    hasDescription,
    descriptionLength,
    hasImages,
    imageCount,
    hasSEOTitle,
    hasSEODescription,
    schemaMarkupStatus: analyzeContentReadiness(product),
    suggestedImprovements: generateProductSuggestions(product, language),
  };
}

/**
 * 分析产品的内容完整度（用于评估 Schema 标记就绪状态）
 * 
 * 注意：此函数检查产品信息是否完整，而不是检测页面上是否已有 Schema 标记。
 * 完整的产品信息是添加 Schema 标记的前提条件。
 * 
 * @returns "complete" - 产品信息完整，可以添加完整的 Schema 标记
 * @returns "partial" - 产品信息部分完整，Schema 标记会缺少某些字段
 * @returns "missing" - 产品信息严重不足，不建议添加 Schema 标记
 */
function analyzeContentReadiness(product: ProductNode): "complete" | "partial" | "missing" {
  const hasDescription = Boolean(product.description?.trim());
  const hasImages = product.images.edges.length > 0;
  // 修复：使用 priceRange.minVariantPrice.amount 判定价格，避免 variants(first:1) 误判
  // priceRange 包含所有 variants 的最低价格，更加准确
  const minAmount = parseFloat(product.priceRange?.minVariantPrice?.amount ?? "0");
  const hasPrice = Number.isFinite(minAmount) && minAmount > 0;
  const hasSEO = Boolean(product.seo?.title || product.seo?.description);
  
  const score = [hasDescription, hasImages, hasPrice, hasSEO].filter(Boolean).length;
  
  if (score >= 4) return "complete";
  if (score >= 2) return "partial";
  return "missing";
}

/**
 * 产品改进建议的双语文本
 */
const PRODUCT_SUGGESTION_TEXTS = {
  noDescription: {
    en: "Add product description to improve AI understanding",
    zh: "添加产品描述以提高 AI 理解能力",
  },
  shortDescription: {
    en: "Expand product description to at least 100 characters for richer context",
    zh: "扩展产品描述至少 100 字以提供更丰富的上下文",
  },
  noImages: {
    en: "Add product images",
    zh: "添加产品图片",
  },
  missingAlt: {
    en: (count: number) => `Add alt text to ${count} image${count > 1 ? "s" : ""}`,
    zh: (count: number) => `为 ${count} 张图片添加 alt 文本`,
  },
  noSeoTitle: {
    en: "Set SEO title to optimize AI search visibility",
    zh: "设置 SEO 标题以优化 AI 搜索可见性",
  },
  noSeoDescription: {
    en: "Set SEO description to improve AI recommendation probability",
    zh: "设置 SEO 描述以提高 AI 推荐概率",
  },
  noProductType: {
    en: "Set product type for better AI categorization",
    zh: "设置产品类型以便 AI 更好地分类",
  },
} as const;

/**
 * 生成产品级改进建议（支持双语）
 */
function generateProductSuggestions(product: ProductNode, language: string = "English"): string[] {
  const suggestions: string[] = [];
  const isEnglish = language === "English";
  const lang = isEnglish ? "en" : "zh";
  
  if (!product.description?.trim()) {
    suggestions.push(PRODUCT_SUGGESTION_TEXTS.noDescription[lang]);
  } else if (product.description.length < 100) {
    suggestions.push(PRODUCT_SUGGESTION_TEXTS.shortDescription[lang]);
  }
  
  if (product.images.edges.length === 0) {
    suggestions.push(PRODUCT_SUGGESTION_TEXTS.noImages[lang]);
  } else {
    const missingAlt = product.images.edges.filter(e => !e.node.altText).length;
    if (missingAlt > 0) {
      suggestions.push(PRODUCT_SUGGESTION_TEXTS.missingAlt[lang](missingAlt));
    }
  }
  
  if (!product.seo?.title) {
    suggestions.push(PRODUCT_SUGGESTION_TEXTS.noSeoTitle[lang]);
  }
  
  if (!product.seo?.description) {
    suggestions.push(PRODUCT_SUGGESTION_TEXTS.noSeoDescription[lang]);
  }
  
  if (!product.productType) {
    suggestions.push(PRODUCT_SUGGESTION_TEXTS.noProductType[lang]);
  }
  
  return suggestions;
}

/**
 * 基于 AI 热销产品生成 FAQ 建议
 * 注意：发货相关的 FAQ 为模板，商家需要根据实际情况修改
 */
function generateFAQSuggestions(
  products: ProductNode[],
  language: string,
): { question: string; suggestedAnswer: string; basedOnProduct: string }[] {
  const faqs: { question: string; suggestedAnswer: string; basedOnProduct: string }[] = [];
  const isEnglish = language === "English";
  
  for (const product of products.slice(0, 5)) {
    // 基于产品生成常见问题
    const productName = product.title;
    
    // 获取价格和货币信息
    const priceInfo = product.priceRange?.minVariantPrice;
    const price = priceInfo?.amount || product.variants.edges[0]?.node.price;
    const currencyCode = priceInfo?.currencyCode || "USD";
    
    // 价格问题 - 基于实际产品数据，使用正确的货币格式
    if (price) {
      const formattedPrice = formatPrice(price, currencyCode);
      const descriptionSnippet = product.description 
        ? smartTruncate(product.description, 100, isEnglish)
        : "";
      
      faqs.push({
        question: isEnglish 
          ? `What is the price of ${productName}?`
          : `${productName} 的价格是多少？`,
        suggestedAnswer: isEnglish
          ? `${productName} is priced at ${formattedPrice}.${descriptionSnippet ? ` ${descriptionSnippet}` : ""}`
          : `${productName} 的价格是 ${formattedPrice}。${descriptionSnippet || ""}`,
        basedOnProduct: product.id,
      });
    }
    
    // 产品特点问题 - 基于实际产品描述，使用智能截断
    if (product.description) {
      faqs.push({
        question: isEnglish
          ? `What are the key features of ${productName}?`
          : `${productName} 有什么特点？`,
        suggestedAnswer: smartTruncate(product.description, 200, isEnglish),
        basedOnProduct: product.id,
      });
    }
    
    // 发货问题 - 模板答案，需要商家自定义
    faqs.push({
      question: isEnglish
        ? `How long does shipping take for ${productName}?`
        : `${productName} 发货需要多久？`,
      suggestedAnswer: isEnglish
        ? "[Please customize] We typically ship orders within X business days. Actual delivery times depend on your location."
        : "[请根据实际情况修改] 我们通常在 X 个工作日内发货。具体送达时间因地区而异。",
      basedOnProduct: product.id,
    });
  }
  
  return faqs;
}

/**
 * 生成优化建议（双语版本）
 * 
 * @param products - 产品性能数据
 * @param language - 语言设置
 * @param hasLlmsTxtEnabled - llms.txt 是否已启用
 * @param hasFAQContent - 是否有 FAQ 内容
 * @param isSchemaEmbedEnabled - App Embed 是否已启用（true/false/null）
 * @param shopDomain - 店铺域名（用于生成 deep link）
 * @param apiKey - App 的 API Key（用于生成带 activateAppId 的 deep link）
 */
function generateSuggestions(
  products: ProductAIPerformance[],
  language: string,
  hasLlmsTxtEnabled: boolean = false,
  hasFAQContent: boolean = false,
  isSchemaEmbedEnabled: boolean | null = null,
  shopDomain: string = "",
  apiKey: string = "",
): OptimizationSuggestion[] {
  const suggestions: OptimizationSuggestion[] = [];
  const isEnglish = language === "English";
  
  // 检查产品信息完整度（作为 Schema 标记的前提条件）
  const missingSchema = products.filter(p => p.schemaMarkupStatus === "missing").length;
  const partialSchema = products.filter(p => p.schemaMarkupStatus === "partial").length;
  const incompleteProducts = missingSchema + partialSchema;
  
  // ============================================================================
  // 建议 A（高优先级）：当 App Embed 未启用或无法确定时显示"启用 App Embed"
  // - isSchemaEmbedEnabled === false: 明确检测到未启用
  // - isSchemaEmbedEnabled === null: 无法确定（API 失败或未找到 block）
  // - 只有 isSchemaEmbedEnabled === true 时才不显示此建议
  // ============================================================================
  if (isSchemaEmbedEnabled !== true) {
    const deepLink = shopDomain ? getAppEmbedDeepLink(shopDomain, { apiKey }) : "";
    
    // 使用公共文案模块获取对应状态的文案
    const status = toEmbedStatus(isSchemaEmbedEnabled);
    const copy = getEmbedCopy(status);
    
    suggestions.push({
      id: "schema-embed-disabled",
      category: "schema_markup",
      priority: "high",
      title: copy.title,
      description: copy.description,
      impact: isEnglish ? copy.impact.en : copy.impact.zh,
      action: isEnglish
        ? `${MANUAL_PATH_COPY.en}${deepLink ? ` Or use this direct link: ${deepLink}` : ""}`
        : `${MANUAL_PATH_COPY.zh}${deepLink ? ` 或使用此直达链接：${deepLink}` : ""}`,
      estimatedLift: copy.estimatedLift,
    });
  }
  
  // ============================================================================
  // 建议 B（中/高优先级）：当有产品信息不完整时显示"完善产品信息"
  // 注意：这是独立于 App Embed 的建议，针对产品内容本身
  // ============================================================================
  if (incompleteProducts > 0) {
    suggestions.push({
      id: "schema-product-info-incomplete",
      category: "product_info",
      priority: missingSchema > 0 ? "high" : "medium",
      title: {
        en: "Complete Product Information for Schema Markup",
        zh: "完善产品信息以支持 Schema 标记",
      },
      description: {
        en: `${incompleteProducts} product${incompleteProducts > 1 ? "s have" : " has"} incomplete information. Missing fields like description, images, price, or SEO data will result in incomplete Schema markup.`,
        zh: `${incompleteProducts} 个产品信息不完整。缺少描述、图片、价格或 SEO 数据会导致 Schema 标记不完整。`,
      },
      impact: isEnglish
        ? "Complete product information enables full Schema markup, improving AI discoverability and search rankings."
        : "完整的产品信息可生成完整的 Schema 标记，提升 AI 可发现性和搜索排名。",
      action: isEnglish
        ? "Review products and add missing fields: product description, high-quality images, SEO title & description, and ensure prices are set correctly."
        : "检查产品并补充缺失字段：产品描述、高质量图片、SEO 标题与描述，并确保价格设置正确。",
      affectedProducts: products
        .filter(p => p.schemaMarkupStatus === "missing" || p.schemaMarkupStatus === "partial")
        .map(p => p.productId),
      estimatedLift: missingSchema > 0 ? "+15-25% AI visibility" : "+10-15% AI visibility",
    });
  }
  
  // 检查产品描述质量
  const shortDescriptions = products.filter(p => p.descriptionLength < 100).length;
  if (shortDescriptions > 0) {
    suggestions.push({
      id: "content-short-desc",
      category: "content_quality",
      priority: "high",
      title: {
        en: "Expand Product Descriptions",
        zh: "扩展产品描述",
      },
      description: {
        en: `${shortDescriptions} products have descriptions under 100 characters. Longer, detailed descriptions help AI understand and recommend products.`,
        zh: `${shortDescriptions} 个产品的描述少于 100 字符。更长、更详细的描述有助于 AI 理解和推荐产品。`,
      },
      impact: isEnglish
        ? "Products with rich descriptions provide more context for AI platforms."
        : "丰富的产品描述为 AI 平台提供更多上下文信息。",
      action: isEnglish
        ? "Add detailed product descriptions including features, benefits, and specifications."
        : "添加详细的产品描述，包括功能、优势和规格。",
      affectedProducts: products.filter(p => p.descriptionLength < 100).map(p => p.productId),
      estimatedLift: "+30-50% AI recommendations",
    });
  }
  
  // FAQ 覆盖建议 - 只有当有产品数据且用户尚未添加 FAQ 内容时才显示
  if (products.length > 0 && !hasFAQContent) {
    suggestions.push({
      id: "faq-coverage",
      category: "faq_coverage",
      priority: "medium",
      title: {
        en: "Add FAQ Section",
        zh: "添加 FAQ 板块",
      },
      description: {
        en: "FAQ content helps AI assistants answer customer questions about your products directly.",
        zh: "FAQ 内容帮助 AI 助手直接回答客户关于产品的问题。",
      },
      impact: isEnglish
        ? "Comprehensive FAQs can improve AI-referred traffic for product queries."
        : "全面的 FAQ 可以提升产品查询的 AI 引荐流量。",
      action: isEnglish
        ? "Create FAQ pages covering pricing, shipping, returns, and product features."
        : "创建涵盖定价、发货、退货和产品特性的 FAQ 页面。",
      estimatedLift: "+20-40% AI traffic",
    });
  }
  
  // AI 可见性建议 - llms.txt 配置
  if (!hasLlmsTxtEnabled) {
    suggestions.push({
      id: "llms-txt-optimization",
      category: "ai_visibility",
      priority: "high",
      title: {
        en: "Optimize llms.txt Configuration",
        zh: "优化 llms.txt 配置",
      },
      description: {
        en: "Your llms.txt file guides AI crawlers. Ensure it highlights your best-performing AI products.",
        zh: "您的 llms.txt 文件指引 AI 爬虫。确保它突出展示您表现最好的 AI 产品。",
      },
      impact: isEnglish
        ? "Properly configured llms.txt can increase AI crawler efficiency."
        : "正确配置的 llms.txt 可以提高 AI 爬虫的效率。",
      action: isEnglish
        ? "Enable all content types in llms.txt settings."
        : "在 llms.txt 设置中启用所有内容类型。",
      estimatedLift: "+10-20% AI discovery",
    });
  }
  
  return suggestions;
}

/**
 * 计算 FAQ 覆盖分数
 * 基于产品信息的完整度来评估 FAQ 生成潜力
 * - 有详细描述：可以生成产品特点 FAQ
 * - 有价格信息：可以生成价格 FAQ
 * - 有多张图片：可以生成外观相关 FAQ
 * - 有 SEO 描述：可以生成搜索相关 FAQ
 */
function calculateFAQCoverage(products: ProductAIPerformance[]): number {
  if (products.length === 0) return 0;
  
  const faqScores = products.map(p => {
    let score = 0;
    
    // 有详细描述可以生成产品特点 FAQ (+30)
    if (p.descriptionLength >= 200) score += 30;
    else if (p.descriptionLength >= 100) score += 20;
    else if (p.hasDescription) score += 10;
    
    // 有多张图片可以生成外观相关 FAQ (+25)
    if (p.imageCount >= 3) score += 25;
    else if (p.hasImages) score += 15;
    
    // 有 SEO 信息可以更好地回答搜索问题 (+25)
    if (p.hasSEOTitle && p.hasSEODescription) score += 25;
    else if (p.hasSEOTitle || p.hasSEODescription) score += 15;
    
    // Schema 完整说明可以提供结构化答案 (+20)
    if (p.schemaMarkupStatus === "complete") score += 20;
    else if (p.schemaMarkupStatus === "partial") score += 10;
    
    return score;
  });
  
  return Math.round(faqScores.reduce((a, b) => a + b, 0) / products.length);
}

/**
 * 计算优化分数
 */
function calculateScores(products: ProductAIPerformance[]): {
  overall: number;
  schemaMarkup: number;
  contentQuality: number;
  faqCoverage: number;
  productCompleteness: number;
} {
  if (products.length === 0) {
    return { overall: 0, schemaMarkup: 0, contentQuality: 0, faqCoverage: 0, productCompleteness: 0 };
  }
  
  // Schema 标记分数
  const schemaScores: number[] = products.map(p => {
    if (p.schemaMarkupStatus === "complete") return 100;
    if (p.schemaMarkupStatus === "partial") return 50;
    return 0;
  });
  const schemaMarkup = Math.round(schemaScores.reduce((a: number, b: number) => a + b, 0) / products.length);
  
  // 内容质量分数
  const contentScores = products.map(p => {
    let score = 0;
    if (p.descriptionLength >= 200) score += 40;
    else if (p.descriptionLength >= 100) score += 20;
    if (p.hasSEOTitle) score += 30;
    if (p.hasSEODescription) score += 30;
    return score;
  });
  const contentQuality = Math.round(contentScores.reduce((a, b) => a + b, 0) / products.length);
  
  // FAQ 覆盖分数（基于产品信息完整度计算）
  const faqCoverage = calculateFAQCoverage(products);
  
  // 产品完整度
  const completenessScores = products.map(p => {
    let score = 0;
    if (p.hasDescription) score += 25;
    if (p.hasImages && p.imageCount >= 3) score += 25;
    else if (p.hasImages) score += 15;
    if (p.hasSEOTitle) score += 25;
    if (p.hasSEODescription) score += 25;
    return score;
  });
  const productCompleteness = Math.round(completenessScores.reduce((a, b) => a + b, 0) / products.length);
  
  // 总分 = 加权平均
  const overall = Math.round(
    schemaMarkup * 0.3 +
    contentQuality * 0.3 +
    faqCoverage * 0.2 +
    productCompleteness * 0.2
  );
  
  return { overall, schemaMarkup, contentQuality, faqCoverage, productCompleteness };
}

/**
 * 生成 AI 优化报告
 * 
 * @param shopDomain - 店铺域名
 * @param admin - Shopify Admin GraphQL 客户端
 * @param options - 配置选项
 * @param options.embedEnabled - 外部传入的 embed 状态（避免重复检测）
 *   - true: 已启用
 *   - false: 未启用
 *   - null: 无法确定
 *   - undefined: 未传入，函数内部会自行检测
 * @param options.apiKey - App 的 API Key（用于生成带 activateAppId 的 deep link）
 */
export async function generateAIOptimizationReport(
  shopDomain: string,
  admin: AdminGraphqlClient | undefined,
  options: {
    range?: TimeRangeKey;
    language?: string;
    exposurePreferences?: {
      exposeProducts: boolean;
      exposeCollections: boolean;
      exposeBlogs: boolean;
    };
    /** 外部传入的 embed 状态，传入后不再重复检测 */
    embedEnabled?: boolean | null;
    /** App 的 API Key（用于生成带 activateAppId 的 deep link） */
    apiKey?: string;
  } = {},
): Promise<AIOptimizationReport> {
  const rangeKey = options.range || "30d";
  const language = options.language || "English";
  const range = resolveDateRange(rangeKey, new Date());
  const exposurePrefs = options.exposurePreferences;
  
  // 获取 AI 渠道的产品数据
  // 限制最大返回数量，防止大数据量导致 OOM（MAX_ORDER_PRODUCTS 从 constants.ts 导入）
  const orderProducts = await prisma.orderProduct.findMany({
    where: {
      order: {
        shopDomain,
        aiSource: { not: null },
        createdAt: { gte: range.start, lte: range.end },
      },
    },
    select: {
      orderId: true,  // 添加 orderId 用于正确去重
      productId: true,
      title: true,
      handle: true,
      url: true,
      price: true,
      quantity: true,
      order: {
        select: {
          aiSource: true,
          totalPrice: true,
        },
      },
    },
    take: MAX_ORDER_PRODUCTS,
    orderBy: {
      order: {
        createdAt: "desc",
      },
    },
  });
  
  // 按产品聚合
  const productAgg = new Map<string, {
    productId: string;
    title: string;
    handle: string;
    url: string;
    aiGMV: number;
    aiOrders: number;
    channels: Map<string, number>;
  }>();
  
  // 使用 orderId + productId 组合来正确去重（同一订单中可能有多个相同产品行项）
  const seenOrderProducts = new Set<string>();
  
  for (const op of orderProducts) {
    // 使用真正的订单 ID 进行去重，而不是 totalPrice + aiSource
    const orderProductKey = `${op.orderId}-${op.productId}`;
    
    if (!productAgg.has(op.productId)) {
      productAgg.set(op.productId, {
        productId: op.productId,
        title: op.title,
        handle: op.handle || "",
        url: op.url || "",
        aiGMV: 0,
        aiOrders: 0,
        channels: new Map(),
      });
    }
    
    const agg = productAgg.get(op.productId)!;
    // Prisma Decimal 不能直接参与算术运算（TS2362），这里显式转为 number
    const price = Number(op.price);
    const qty = op.quantity || 0;
    const lineAmount = (Number.isFinite(price) ? price : 0) * qty;
    agg.aiGMV += lineAmount;
    
    // 同一订单的同一产品只计算一次订单数
    if (!seenOrderProducts.has(orderProductKey)) {
      agg.aiOrders += 1;
      seenOrderProducts.add(orderProductKey);
    }
    
    const channel = fromPrismaAiSource(op.order.aiSource);
    if (channel) {
      agg.channels.set(channel, (agg.channels.get(channel) || 0) + lineAmount);
    }
  }
  
  // 获取产品详细信息
  const productIds = Array.from(productAgg.keys());
  const productDetails = admin 
    ? await fetchProductDetails(admin, shopDomain, productIds)
    : new Map<string, ProductNode>();
  
  // 构建产品性能数据
  const products: ProductAIPerformance[] = Array.from(productAgg.values())
    .map(agg => {
      const details = productDetails.get(agg.productId);
      const topChannel = Array.from(agg.channels.entries())
        .sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      
      const description = details?.description || "";
      const hasDescription = Boolean(description.trim());
      const descriptionLength = description.length;
      const hasImages = (details?.images.edges.length || 0) > 0;
      const imageCount = details?.images.edges.length || 0;
      const hasSEOTitle = Boolean(details?.seo?.title);
      const hasSEODescription = Boolean(details?.seo?.description);
      
      return {
        productId: agg.productId,
        title: agg.title,
        handle: agg.handle,
        url: agg.url,
        aiGMV: agg.aiGMV,
        aiOrders: agg.aiOrders,
        totalGMV: agg.aiGMV, // 如需全站数据需要额外查询
        totalOrders: agg.aiOrders,
        aiShare: 1, // 如需精确计算需要额外查询
        topChannel,
        hasDescription,
        descriptionLength,
        hasImages,
        imageCount,
        hasSEOTitle,
        hasSEODescription,
        schemaMarkupStatus: details ? analyzeContentReadiness(details) : "missing",
        suggestedImprovements: details ? generateProductSuggestions(details, language) : [],
      };
    })
    .sort((a, b) => b.aiGMV - a.aiGMV);
  
  // 如果没有 AI 订单数据，获取店铺最新产品来计算准备度分数
  let productsForScoring: ProductAIPerformance[] = products;
  let fallbackProductNodes: ProductNode[] = [];
  const hasAIOrderData = products.length > 0;
  
  if (!hasAIOrderData && admin) {
    // 获取店铺最新的 20 个产品
    fallbackProductNodes = await fetchRecentProducts(admin, shopDomain, 20);
    productsForScoring = fallbackProductNodes.map(p => productNodeToPerformance(p, shopDomain, language));
    logger.info("[aiOptimization] No AI order data, using recent products for scoring", { 
      shopDomain, 
      productCount: productsForScoring.length 
    });
  }
  
  // 计算分数（基于 AI 订单产品或店铺产品）
  const scores = calculateScores(productsForScoring);
  
  // 检查 llms.txt 是否已启用（至少有一个暴露选项开启）
  const hasLlmsTxtEnabled = Boolean(
    exposurePrefs?.exposeProducts || 
    exposurePrefs?.exposeCollections || 
    exposurePrefs?.exposeBlogs
  );
  
  // 生成 FAQ 建议（先生成 FAQ，然后用于判断是否需要显示 FAQ 建议）
  // 如果有 AI 订单数据，使用 AI 产品；否则使用店铺产品
  const topProductNodes = hasAIOrderData
    ? products
        .slice(0, 5)
        .map(p => productDetails.get(p.productId))
        .filter((p): p is ProductNode => p !== undefined)
    : fallbackProductNodes.slice(0, 5);
  const suggestedFAQs = generateFAQSuggestions(topProductNodes, language);
  
  // 生成建议（基于用于评分的产品）
  // hasFAQContent: 如果已生成 FAQ 建议，说明有足够的产品信息来支持 FAQ
  const hasFAQContent = suggestedFAQs.length > 0;
  
  // 检测 App Embed 是否已启用
  // 如果外部传入了 embedEnabled，则复用；否则自行检测
  const embedEnabled = "embedEnabled" in options
    ? options.embedEnabled
    : (admin ? await isProductSchemaEmbedEnabled(admin, shopDomain) : null);
  
  const suggestions = generateSuggestions(
    productsForScoring, 
    language, 
    hasLlmsTxtEnabled, 
    hasFAQContent,
    embedEnabled,
    shopDomain,
    options.apiKey || ""
  );
  
  // llms.txt 增强建议
  const isEnglish = language === "English";
  
  // 计算 llms.txt 覆盖率（基于启用的内容类型）
  let llmsCoverage = 0;
  const categoryRecommendations: string[] = [];
  
  if (exposurePrefs?.exposeProducts) {
    llmsCoverage += 40;
  } else {
    categoryRecommendations.push(isEnglish ? "Enable product pages exposure" : "开启产品页暴露");
  }
  
  if (exposurePrefs?.exposeBlogs) {
    llmsCoverage += 30;
  } else {
    categoryRecommendations.push(isEnglish ? "Enable blog content for AI discovery" : "开启博客内容供 AI 发现");
  }
  
  if (exposurePrefs?.exposeCollections) {
    llmsCoverage += 30;
  } else {
    categoryRecommendations.push(isEnglish ? "Add collection pages to llms.txt" : "将合集页面添加到 llms.txt");
  }
  
  const llmsEnhancements = {
    currentCoverage: llmsCoverage,
    suggestedAdditions: productsForScoring
      .filter(p => p.schemaMarkupStatus === "complete")
      .slice(0, 5)
      .map(p => p.url),
    categoryRecommendations,
  };
  
  return {
    generatedAt: new Date().toISOString(),
    shopDomain,
    range: { key: rangeKey, label: range.label },
    overallScore: scores.overall,
    scoreBreakdown: {
      schemaMarkup: scores.schemaMarkup,
      contentQuality: scores.contentQuality,
      faqCoverage: scores.faqCoverage,
      productCompleteness: scores.productCompleteness,
    },
    suggestions,
    // topProducts 只显示有 AI 订单的产品（保持原有行为）
    topProducts: products.slice(0, 10),
    underperformingProducts: productsForScoring
      .filter(p => p.schemaMarkupStatus !== "complete" || p.descriptionLength < 100)
      .slice(0, 5),
    suggestedFAQs,
    llmsEnhancements,
  };
}
