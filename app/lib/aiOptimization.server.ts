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
  productType: string | null;
  vendor: string | null;
  tags: string[];
};

// ============================================================================
// Core Functions
// ============================================================================

/**
 * 获取产品详细信息（用于优化分析）
 */
export async function fetchProductDetails(
  admin: AdminGraphqlClient,
  shopDomain: string,
  productIds: string[],
): Promise<Map<string, ProductNode>> {
  const productMap = new Map<string, ProductNode>();
  
  if (!productIds.length) return productMap;

  try {
    const sdk = createGraphqlSdk(admin, shopDomain);
    // Convert GID format to query format
    const queryStr = productIds
      .map(id => {
        const numericId = id.replace(/^gid:\/\/shopify\/Product\//, "");
        return `id:${numericId}`;
      })
      .join(" OR ");
    
    const response = await sdk.request(
      "productsForOptimization",
      PRODUCT_DETAILS_QUERY,
      { first: Math.min(productIds.length, 50), query: queryStr }
    );
    
    if (!response.ok) {
      logger.warn("[aiOptimization] Failed to fetch products", { shopDomain, status: response.status });
      return productMap;
    }
    
    const json = await response.json() as {
      data?: { products?: { edges: { node: ProductNode }[] } };
    };
    
    const products = json.data?.products?.edges || [];
    for (const { node } of products) {
      productMap.set(node.id, node);
    }
  } catch (error) {
    logger.error("[aiOptimization] Error fetching products", { shopDomain }, {
      error: (error as Error).message,
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
function productNodeToPerformance(product: ProductNode, shopDomain: string): ProductAIPerformance {
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
    schemaMarkupStatus: analyzeSchemaStatus(product),
    suggestedImprovements: generateProductSuggestions(product),
  };
}

/**
 * 分析产品的内容完整度
 * 注意：这不是检测页面上是否有 Schema 标记，而是检查产品信息是否完整
 * 完整的产品信息是添加 Schema 标记的前提条件
 */
function analyzeSchemaStatus(product: ProductNode): "complete" | "partial" | "missing" {
  const hasDescription = Boolean(product.description?.trim());
  const hasImages = product.images.edges.length > 0;
  const hasPrice = product.variants.edges.length > 0;
  const hasSEO = Boolean(product.seo?.title || product.seo?.description);
  
  const score = [hasDescription, hasImages, hasPrice, hasSEO].filter(Boolean).length;
  
  if (score >= 4) return "complete";
  if (score >= 2) return "partial";
  return "missing";
}

/**
 * 生成产品级改进建议
 */
function generateProductSuggestions(product: ProductNode): string[] {
  const suggestions: string[] = [];
  
  if (!product.description?.trim()) {
    suggestions.push("添加产品描述以提高 AI 理解能力");
  } else if (product.description.length < 100) {
    suggestions.push("扩展产品描述至少 100 字以提供更丰富的上下文");
  }
  
  if (product.images.edges.length === 0) {
    suggestions.push("添加产品图片");
  } else {
    const missingAlt = product.images.edges.filter(e => !e.node.altText).length;
    if (missingAlt > 0) {
      suggestions.push(`为 ${missingAlt} 张图片添加 alt 文本`);
    }
  }
  
  if (!product.seo?.title) {
    suggestions.push("设置 SEO 标题以优化 AI 搜索可见性");
  }
  
  if (!product.seo?.description) {
    suggestions.push("设置 SEO 描述以提高 AI 推荐概率");
  }
  
  if (!product.productType) {
    suggestions.push("设置产品类型以便 AI 更好地分类");
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
    const price = product.variants.edges[0]?.node.price;
    
    // 价格问题 - 基于实际产品数据
    if (price) {
      faqs.push({
        question: isEnglish 
          ? `What is the price of ${productName}?`
          : `${productName} 的价格是多少？`,
        suggestedAnswer: isEnglish
          ? `${productName} is priced at $${price}. ${product.description?.slice(0, 100) || ""}`
          : `${productName} 的价格是 $${price}。${product.description?.slice(0, 100) || ""}`,
        basedOnProduct: product.id,
      });
    }
    
    // 产品特点问题 - 基于实际产品描述
    if (product.description) {
      faqs.push({
        question: isEnglish
          ? `What are the key features of ${productName}?`
          : `${productName} 有什么特点？`,
        suggestedAnswer: product.description.slice(0, 200),
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
 */
function generateSuggestions(
  products: ProductAIPerformance[],
  _language: string,
  hasLlmsTxtEnabled: boolean = false,
): OptimizationSuggestion[] {
  const suggestions: OptimizationSuggestion[] = [];
  
  // 检查产品信息完整度（作为 Schema 标记的前提条件）
  const missingSchema = products.filter(p => p.schemaMarkupStatus === "missing").length;
  const partialSchema = products.filter(p => p.schemaMarkupStatus === "partial").length;
  
  if (missingSchema > 0) {
    suggestions.push({
      id: "schema-missing",
      category: "schema_markup",
      priority: "high",
      title: {
        en: "Add Product Schema Markup",
        zh: "添加产品 Schema 标记",
      },
      description: {
        en: `${missingSchema} products lack complete information needed for structured data markup, reducing their visibility to AI assistants.`,
        zh: `${missingSchema} 个产品缺少结构化数据标记所需的完整信息，这会降低 AI 助手的识别能力。`,
      },
      impact: "Products with complete schema markup may improve AI discoverability.",
      action: "Add JSON-LD Product schema to your product pages.",
      codeSnippet: `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "{{ product.title }}",
  "description": "{{ product.description | strip_html }}",
  "image": "{{ product.featured_image | img_url: 'large' }}",
  "offers": {
    "@type": "Offer",
    "price": "{{ product.price | money_without_currency }}",
    "priceCurrency": "{{ shop.currency }}",
    "availability": "{% if product.available %}https://schema.org/InStock{% else %}https://schema.org/OutOfStock{% endif %}"
  }
}
</script>`,
      affectedProducts: products.filter(p => p.schemaMarkupStatus === "missing").map(p => p.productId),
      estimatedLift: "+15-25% AI visibility",
    });
  }
  
  if (partialSchema > 0) {
    suggestions.push({
      id: "schema-partial",
      category: "schema_markup",
      priority: "medium",
      title: {
        en: "Complete Product Information",
        zh: "完善产品信息",
      },
      description: {
        en: `${partialSchema} products have incomplete information. Adding missing fields will improve AI understanding.`,
        zh: `${partialSchema} 个产品的信息不完整。补充缺失字段可提升 AI 理解能力。`,
      },
      impact: "Complete product information helps AI provide more accurate recommendations.",
      action: "Review and add missing fields like description, images, SEO title.",
      affectedProducts: products.filter(p => p.schemaMarkupStatus === "partial").map(p => p.productId),
      estimatedLift: "+10-15% AI visibility",
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
      impact: "Products with rich descriptions provide more context for AI platforms.",
      action: "Add detailed product descriptions including features, benefits, and specifications.",
      affectedProducts: products.filter(p => p.descriptionLength < 100).map(p => p.productId),
      estimatedLift: "+30-50% AI recommendations",
    });
  }
  
  // FAQ 覆盖建议 - 只有当有产品数据时才显示
  if (products.length > 0) {
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
      impact: "Comprehensive FAQs can improve AI-referred traffic for product queries.",
      action: "Create FAQ pages covering pricing, shipping, returns, and product features.",
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
      impact: "Properly configured llms.txt can increase AI crawler efficiency.",
      action: "Enable all content types in llms.txt settings.",
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
  } = {},
): Promise<AIOptimizationReport> {
  const rangeKey = options.range || "30d";
  const language = options.language || "中文";
  const range = resolveDateRange(rangeKey, new Date());
  const exposurePrefs = options.exposurePreferences;
  
  // 获取 AI 渠道的产品数据
  const orderProducts = await prisma.orderProduct.findMany({
    where: {
      order: {
        shopDomain,
        aiSource: { not: null },
        createdAt: { gte: range.start, lte: range.end },
      },
    },
    select: {
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
  
  const seenOrders = new Set<string>();
  
  for (const op of orderProducts) {
    const orderKey = `${op.order.totalPrice}-${op.order.aiSource}`;
    
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
    agg.aiGMV += op.price * op.quantity;
    
    if (!seenOrders.has(`${op.productId}-${orderKey}`)) {
      agg.aiOrders += 1;
      seenOrders.add(`${op.productId}-${orderKey}`);
    }
    
    const channel = fromPrismaAiSource(op.order.aiSource);
    if (channel) {
      agg.channels.set(channel, (agg.channels.get(channel) || 0) + op.price * op.quantity);
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
        schemaMarkupStatus: details ? analyzeSchemaStatus(details) : "missing",
        suggestedImprovements: details ? generateProductSuggestions(details) : [],
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
    productsForScoring = fallbackProductNodes.map(p => productNodeToPerformance(p, shopDomain));
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
  
  // 生成建议（基于用于评分的产品）
  const suggestions = generateSuggestions(productsForScoring, language, hasLlmsTxtEnabled);
  
  // 生成 FAQ 建议
  // 如果有 AI 订单数据，使用 AI 产品；否则使用店铺产品
  const topProductNodes = hasAIOrderData
    ? products
        .slice(0, 5)
        .map(p => productDetails.get(p.productId))
        .filter((p): p is ProductNode => p !== undefined)
    : fallbackProductNodes.slice(0, 5);
  const suggestedFAQs = generateFAQSuggestions(topProductNodes, language);
  
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
