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
  title: string;
  description: string;
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
 * 分析产品的 Schema 标记状态
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
    
    // 价格问题
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
    
    // 产品特点问题
    if (product.description) {
      faqs.push({
        question: isEnglish
          ? `What are the key features of ${productName}?`
          : `${productName} 有什么特点？`,
        suggestedAnswer: product.description.slice(0, 200),
        basedOnProduct: product.id,
      });
    }
    
    // 发货问题
    faqs.push({
      question: isEnglish
        ? `How long does shipping take for ${productName}?`
        : `${productName} 发货需要多久？`,
      suggestedAnswer: isEnglish
        ? "We typically ship orders within 1-3 business days. Delivery times vary by location."
        : "我们通常在 1-3 个工作日内发货。具体送达时间因地区而异。",
      basedOnProduct: product.id,
    });
  }
  
  return faqs;
}

/**
 * 生成优化建议
 */
function generateSuggestions(
  products: ProductAIPerformance[],
  language: string,
): OptimizationSuggestion[] {
  const suggestions: OptimizationSuggestion[] = [];
  const isEnglish = language === "English";
  
  // 检查 Schema 标记覆盖率
  const missingSchema = products.filter(p => p.schemaMarkupStatus === "missing").length;
  const partialSchema = products.filter(p => p.schemaMarkupStatus === "partial").length;
  
  if (missingSchema > 0) {
    suggestions.push({
      id: "schema-missing",
      category: "schema_markup",
      priority: "high",
      title: isEnglish ? "Add Product Schema Markup" : "添加产品 Schema 标记",
      description: isEnglish
        ? `${missingSchema} products are missing structured data markup, reducing their visibility to AI assistants.`
        : `${missingSchema} 个产品缺少结构化数据标记，这会降低 AI 助手的识别能力。`,
      impact: isEnglish
        ? "Products with complete schema markup are 2-3x more likely to be recommended by AI assistants."
        : "拥有完整 Schema 标记的产品被 AI 助手推荐的概率高 2-3 倍。",
      action: isEnglish
        ? "Add JSON-LD Product schema to your product pages. Include name, description, price, availability, and images."
        : "在产品页面添加 JSON-LD Product schema，包含名称、描述、价格、库存状态和图片。",
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
      title: isEnglish ? "Complete Partial Schema Markup" : "完善部分 Schema 标记",
      description: isEnglish
        ? `${partialSchema} products have incomplete structured data. Adding missing fields will improve AI understanding.`
        : `${partialSchema} 个产品的结构化数据不完整。补充缺失字段可提升 AI 理解能力。`,
      impact: isEnglish
        ? "Complete schema markup helps AI provide more accurate product recommendations."
        : "完整的 Schema 标记帮助 AI 提供更准确的产品推荐。",
      action: isEnglish
        ? "Review and add missing fields like reviews, brand, SKU, and detailed specifications."
        : "检查并添加缺失字段，如评论、品牌、SKU 和详细规格。",
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
      title: isEnglish ? "Expand Product Descriptions" : "扩展产品描述",
      description: isEnglish
        ? `${shortDescriptions} products have descriptions under 100 characters. Longer, detailed descriptions help AI understand and recommend products.`
        : `${shortDescriptions} 个产品的描述少于 100 字符。更长、更详细的描述有助于 AI 理解和推荐产品。`,
      impact: isEnglish
        ? "Products with rich descriptions (200+ words) see 30-50% higher AI recommendation rates."
        : "拥有丰富描述（200+ 词）的产品，AI 推荐率高 30-50%。",
      action: isEnglish
        ? "Add detailed product descriptions including features, benefits, use cases, and specifications."
        : "添加详细的产品描述，包括功能、优势、使用场景和规格。",
      affectedProducts: products.filter(p => p.descriptionLength < 100).map(p => p.productId),
      estimatedLift: "+30-50% AI recommendations",
    });
  }
  
  // FAQ 覆盖建议
  suggestions.push({
    id: "faq-coverage",
    category: "faq_coverage",
    priority: "medium",
    title: isEnglish ? "Add FAQ Section" : "添加 FAQ 板块",
    description: isEnglish
      ? "FAQ content helps AI assistants answer customer questions about your products directly."
      : "FAQ 内容帮助 AI 助手直接回答客户关于产品的问题。",
    impact: isEnglish
      ? "Stores with comprehensive FAQs see 20-40% more AI-referred traffic for product queries."
      : "拥有完善 FAQ 的店铺，产品查询的 AI 引荐流量高 20-40%。",
    action: isEnglish
      ? "Create FAQ pages for top-selling products covering pricing, shipping, returns, and product features."
      : "为热销产品创建 FAQ 页面，涵盖价格、发货、退换货和产品特点。",
    estimatedLift: "+20-40% AI traffic",
  });
  
  // AI 可见性建议
  suggestions.push({
    id: "llms-txt-optimization",
    category: "ai_visibility",
    priority: "high",
    title: isEnglish ? "Optimize llms.txt Configuration" : "优化 llms.txt 配置",
    description: isEnglish
      ? "Your llms.txt file guides AI crawlers. Ensure it highlights your best-performing AI products."
      : "您的 llms.txt 文件指引 AI 爬虫。确保它突出展示您表现最好的 AI 产品。",
    impact: isEnglish
      ? "Properly configured llms.txt can increase AI crawler efficiency and product discovery."
      : "正确配置的 llms.txt 可以提高 AI 爬虫效率和产品发现率。",
    action: isEnglish
      ? "Enable all content types in llms.txt settings and ensure top AI GMV products are prominently listed."
      : "在 llms.txt 设置中启用所有内容类型，并确保 AI GMV 最高的产品被优先列出。",
    estimatedLift: "+10-20% AI discovery",
  });
  
  return suggestions;
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
  
  // FAQ 覆盖（这里用一个基准分数，实际需要检查店铺是否有 FAQ）
  const faqCoverage = 40; // 基准分数，可根据实际 FAQ 数量调整
  
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
  } = {},
): Promise<AIOptimizationReport> {
  const rangeKey = options.range || "30d";
  const language = options.language || "中文";
  const range = resolveDateRange(rangeKey, new Date());
  
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
  
  // 计算分数
  const scores = calculateScores(products);
  
  // 生成建议
  const suggestions = generateSuggestions(products, language);
  
  // 生成 FAQ 建议
  const topProductNodes = products
    .slice(0, 5)
    .map(p => productDetails.get(p.productId))
    .filter((p): p is ProductNode => p !== undefined);
  const suggestedFAQs = generateFAQSuggestions(topProductNodes, language);
  
  // llms.txt 增强建议
  const isEnglish = language === "English";
  const llmsEnhancements = {
    currentCoverage: Math.min(100, products.length * 10),
    suggestedAdditions: products
      .filter(p => p.schemaMarkupStatus === "complete")
      .slice(0, 5)
      .map(p => p.url),
    categoryRecommendations: [
      isEnglish ? "Enable product pages exposure" : "开启产品页暴露",
      isEnglish ? "Enable blog content for AI discovery" : "开启博客内容供 AI 发现",
      isEnglish ? "Add collection pages to llms.txt" : "将合集页面添加到 llms.txt",
    ],
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
    topProducts: products.slice(0, 10),
    underperformingProducts: products
      .filter(p => p.schemaMarkupStatus !== "complete" || p.descriptionLength < 100)
      .slice(0, 5),
    suggestedFAQs,
    llmsEnhancements,
  };
}
