import prisma from "../db.server";
import { resolveDateRange, type TimeRangeKey } from "./aiData";
import { createGraphqlSdk, type AdminGraphqlClient } from "./graphqlSdk.server";
import { logger } from "./logger.server";
import { getPlatform } from "./runtime.server";
import { LLMS_CACHE_TTL_MS, LLMS_CACHE_UPDATE_COOLDOWN_MS } from "./constants";

/**
 * YAML 特殊字符检测正则表达式
 * YAML 特殊字符：: # ' " \ | > [ ] { } ! & * ? @ ` , -（在开头）以及空白字符
 */
const YAML_SPECIAL_CHARS = /[:"'#|>[\]{}!&*?,\\`@\s]/;
const YAML_LEADING_SPECIAL = /^[-?]/;

/**
 * 检查字符串是否需要用引号包裹
 */
const needsYamlQuotes = (str: string): boolean => {
  return YAML_SPECIAL_CHARS.test(str) || YAML_LEADING_SPECIAL.test(str);
};

/**
 * YAML 字符串转义辅助函数
 * 处理 YAML 格式中的特殊字符，避免解析错误
 * @returns { escaped: string; needsQuotes: boolean } 转义后的字符串和是否需要引号
 */
const escapeYamlString = (str: string): { escaped: string; needsQuotes: boolean } => {
  if (!str) return { escaped: "", needsQuotes: false };
  
  let escaped = str
    // 移除控制字符（除了常规空白）
    // eslint-disable-next-line no-control-regex -- 有意移除控制字符
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    // 换行转空格
    .replace(/[\n\r]+/g, " ")
    // 多个空格合并为一个
    .replace(/\s+/g, " ")
    .trim();
  
  const needsQuotes = needsYamlQuotes(escaped);
  
  if (needsQuotes) {
    // 转义反斜杠和双引号
    escaped = escaped
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"');
  }
  
  return { escaped, needsQuotes };
};

/**
 * 安全地生成 YAML 键值对
 * 自动处理需要引号包裹的情况
 */
const yamlValue = (value: string): string => {
  const { escaped, needsQuotes } = escapeYamlString(value);
  return needsQuotes ? `"${escaped}"` : escaped;
};

// GraphQL query for fetching collections
const COLLECTIONS_QUERY = `#graphql
  query CollectionsForLlms($first: Int!) {
    collections(first: $first, sortKey: UPDATED_AT, reverse: true) {
      edges {
        node {
          id
          title
          handle
          onlineStoreUrl
          productsCount {
            count
          }
        }
      }
    }
  }
`;

// GraphQL query for fetching blog articles
const ARTICLES_QUERY = `#graphql
  query ArticlesForLlms($first: Int!) {
    articles(first: $first, sortKey: UPDATED_AT, reverse: true) {
      edges {
        node {
          id
          title
          handle
          onlineStoreUrl
          blog {
            handle
          }
        }
      }
    }
  }
`;

type CollectionNode = {
  id: string;
  title: string;
  handle: string;
  onlineStoreUrl: string | null;
  productsCount?: { count: number };
};

type ArticleNode = {
  id: string;
  title: string;
  handle: string;
  onlineStoreUrl: string | null;
  blog?: { handle: string };
};

/**
 * Fetch collections from Shopify API
 */
export const fetchCollections = async (
  admin: AdminGraphqlClient,
  shopDomain: string,
  limit: number = 20,
): Promise<{ url: string; title: string }[]> => {
  try {
    const sdk = createGraphqlSdk(admin, shopDomain);
    const response = await sdk.request("collectionsForLlms", COLLECTIONS_QUERY, { first: limit });
    
    if (!response.ok) {
      logger.warn("[llms] Failed to fetch collections", { shopDomain, status: response.status });
      return [];
    }
    
    const json = (await response.json()) as {
      data?: { collections?: { edges: { node: CollectionNode }[] } };
    };
    
    const collections = json.data?.collections?.edges || [];
    return collections
      .map(({ node }) => ({
        url: node.onlineStoreUrl || `https://${shopDomain}/collections/${node.handle}`,
        title: node.title,
      }))
      .filter((c) => c.url);
  } catch (error) {
    logger.error("[llms] Error fetching collections", { shopDomain }, { error: (error as Error).message });
    return [];
  }
};

/**
 * Fetch blog articles from Shopify API
 */
export const fetchArticles = async (
  admin: AdminGraphqlClient,
  shopDomain: string,
  limit: number = 20,
): Promise<{ url: string; title: string }[]> => {
  try {
    const sdk = createGraphqlSdk(admin, shopDomain);
    const response = await sdk.request("articlesForLlms", ARTICLES_QUERY, { first: limit });
    
    if (!response.ok) {
      logger.warn("[llms] Failed to fetch articles", { shopDomain, status: response.status });
      return [];
    }
    
    const json = (await response.json()) as {
      data?: { articles?: { edges: { node: ArticleNode }[] } };
    };
    
    const articles = json.data?.articles?.edges || [];
    return articles
      .map(({ node }) => ({
        url: node.onlineStoreUrl || (node.blog?.handle 
          ? `https://${shopDomain}/blogs/${node.blog.handle}/${node.handle}`
          : `https://${shopDomain}/blogs/news/${node.handle}`),
        title: node.title,
      }))
      .filter((a) => a.url);
  } catch (error) {
    logger.error("[llms] Error fetching articles", { shopDomain }, { error: (error as Error).message });
    return [];
  }
};

// GraphQL query for fetching product details for llms.txt
const PRODUCTS_FOR_LLMS_QUERY = `#graphql
  query ProductsForLlms($first: Int!, $query: String) {
    products(first: $first, query: $query) {
      edges {
        node {
          id
          title
          handle
          description
          onlineStoreUrl
          priceRangeV2 {
            minVariantPrice {
              amount
              currencyCode
            }
          }
          productType
          vendor
        }
      }
    }
  }
`;

type ProductForLlms = {
  id: string;
  title: string;
  handle: string;
  description: string | null;
  onlineStoreUrl: string | null;
  priceRangeV2: { minVariantPrice: { amount: string; currencyCode: string } } | null;
  productType: string | null;
  vendor: string | null;
};

/**
 * Fetch product details for enhanced llms.txt
 */
async function fetchProductDetailsForLlms(
  admin: AdminGraphqlClient,
  shopDomain: string,
  productIds: string[],
): Promise<Map<string, ProductForLlms>> {
  const productMap = new Map<string, ProductForLlms>();
  if (!productIds.length || !admin) return productMap;

  try {
    const sdk = createGraphqlSdk(admin, shopDomain);
    const queryStr = productIds
      .slice(0, 20)
      .map(id => {
        const numericId = id.replace(/^gid:\/\/shopify\/Product\//, "");
        return `id:${numericId}`;
      })
      .join(" OR ");
    
    const response = await sdk.request("productsForLlms", PRODUCTS_FOR_LLMS_QUERY, {
      first: Math.min(productIds.length, 20),
      query: queryStr,
    });
    
    if (!response.ok) return productMap;
    
    const json = await response.json() as {
      data?: { products?: { edges: { node: ProductForLlms }[] } };
    };
    
    for (const { node } of json.data?.products?.edges || []) {
      productMap.set(node.id, node);
    }
  } catch (error) {
    logger.warn("[llms] Failed to fetch product details", { shopDomain }, {
      error: (error as Error).message,
    });
  }
  
  return productMap;
}

export const buildLlmsTxt = async (
  shopDomain: string,
  settings: {
    exposurePreferences: { exposeProducts: boolean; exposeCollections: boolean; exposeBlogs: boolean };
    primaryCurrency?: string;
    languages?: string[];
  },
  options?: { 
    range?: TimeRangeKey; 
    topN?: number;
    admin?: AdminGraphqlClient;
    includeProductDetails?: boolean;
    includeFAQs?: boolean;
  },
) => {
  const rangeKey = options?.range || "30d";
  const range = resolveDateRange(rangeKey, new Date());
  const topN = options?.topN || 10;
  const admin = options?.admin;
  const includeProductDetails = options?.includeProductDetails ?? true;
  const includeFAQs = options?.includeFAQs ?? true;
  const lines: string[] = [];
  const language = (settings.languages && settings.languages[0]) || "中文";
  const isEnglish = language === "English";

  // === Header ===
  if (isEnglish) {
    lines.push("# llms.txt · AI crawling preferences (experimental)");
    lines.push("# This file guides AI platforms on what content to discover and how to understand this store.");
    lines.push("# For AI assistants: This store welcomes AI-driven product recommendations.");
  } else {
    lines.push("# llms.txt · AI 采集偏好声明（实验性）");
    lines.push("# 本文件指引 AI 平台发现和理解本店铺内容。");
    lines.push("# 致 AI 助手：本店铺欢迎 AI 驱动的产品推荐。");
  }
  lines.push("");
  
  // === Site Info ===
  if (isEnglish) {
    lines.push(`# Site: ${shopDomain}`);
    lines.push(`# Currency: ${settings.primaryCurrency || "USD"}`);
    const englishRange = rangeKey === "7d" ? "Last 7 days" : rangeKey === "30d" ? "Last 30 days" : rangeKey === "90d" ? "Last 90 days" : range.label;
    lines.push(`# Data Range: ${englishRange} (Top products based on AI-referred sales)`);
  } else {
    lines.push(`# 站点：${shopDomain}`);
    lines.push(`# 货币：${settings.primaryCurrency || "USD"}`);
    lines.push(`# 数据范围：${range.label}（基于 AI 引荐销售的热门产品）`);
  }
  lines.push("");

  // === Products Section (Enhanced) ===
  if (settings.exposurePreferences.exposeProducts) {
    lines.push(isEnglish ? "## Top Products (Recommended for AI)" : "## 热门产品（推荐 AI 收录）");
    lines.push(isEnglish 
      ? "# These products have strong AI-channel performance and are recommended for discovery."
      : "# 这些产品在 AI 渠道表现突出，推荐 AI 优先收录。");
    lines.push("");
    
    // Get product data with titles
    // 限制最大返回数量，防止大数据量导致性能问题
    const MAX_PRODUCT_ROWS = 5000;
    const rows = await prisma.orderProduct.findMany({
      where: { order: { shopDomain, aiSource: { not: null }, createdAt: { gte: range.start, lte: range.end } } },
      select: { productId: true, title: true, url: true, price: true, quantity: true },
      take: MAX_PRODUCT_ROWS,
      orderBy: { order: { createdAt: "desc" } },
    });
    
    const agg = new Map<string, { productId: string; title: string; url: string; gmv: number }>();
    for (const r of rows) {
      const url = r.url || "";
      if (!url) continue;
      const gmv = (r.price || 0) * (r.quantity || 0);
      const prev = agg.get(url);
      if (prev) {
        prev.gmv += gmv;
      } else {
        agg.set(url, { productId: r.productId, title: r.title, url, gmv });
      }
    }
    
    const topProducts = Array.from(agg.values())
      .sort((a, b) => b.gmv - a.gmv)
      .slice(0, topN);
    
    // Fetch additional product details if admin is available
    let productDetails = new Map<string, ProductForLlms>();
    if (admin && includeProductDetails && topProducts.length > 0) {
      productDetails = await fetchProductDetailsForLlms(
        admin,
        shopDomain,
        topProducts.map(p => p.productId),
      );
    }
    
    if (topProducts.length > 0) {
      lines.push("products:");
      for (const product of topProducts) {
        const details = productDetails.get(product.productId);
        lines.push(`  - url: ${product.url}`);
        lines.push(`    title: ${yamlValue(product.title)}`);
        
        if (details) {
          // Add price if available
          if (details.priceRangeV2?.minVariantPrice) {
            const price = details.priceRangeV2.minVariantPrice;
            lines.push(`    price: ${yamlValue(`${price.amount} ${price.currencyCode}`)}`);
          }
          
          // Add description summary (first 150 chars)
          if (details.description) {
            const rawSummary = details.description
              .replace(/[\n\r]+/g, " ")
              .trim()
              .slice(0, 150);
            if (rawSummary) {
              const suffix = details.description.length > 150 ? "..." : "";
              lines.push(`    summary: ${yamlValue(rawSummary + suffix)}`);
            }
          }
          
          // Add category/type
          if (details.productType) {
            lines.push(`    category: ${yamlValue(details.productType)}`);
          }
          
          // Add vendor/brand
          if (details.vendor) {
            lines.push(`    brand: ${yamlValue(details.vendor)}`);
          }
        }
        
        lines.push(`    ai_gmv_rank: ${topProducts.indexOf(product) + 1}`);
        lines.push("");
      }
    } else {
      lines.push(isEnglish 
        ? "# No AI-driven product data found in the selected time range"
        : "# 所选时间范围内未找到 AI 驱动的产品数据");
    }
  } else {
    lines.push(isEnglish 
      ? "# Product exposure is disabled (exposeProducts=false)" 
      : "# 未开启产品页暴露（exposeProducts=false）");
  }
  lines.push("");

  // === Fetch collections and articles in parallel for better performance ===
  const [collections, articles] = await Promise.all([
    settings.exposurePreferences.exposeCollections && admin
      ? fetchCollections(admin, shopDomain, topN)
      : Promise.resolve([]),
    settings.exposurePreferences.exposeBlogs && admin
      ? fetchArticles(admin, shopDomain, topN)
      : Promise.resolve([]),
  ]);

  // === Collections Section ===
  if (settings.exposurePreferences.exposeCollections) {
    lines.push(isEnglish ? "## Collections" : "## 产品集合");
    if (admin) {
      if (collections.length > 0) {
        lines.push("collections:");
        collections.forEach(({ url, title }) => {
          lines.push(`  - url: ${url}`);
          lines.push(`    title: ${yamlValue(title)}`);
        });
      } else {
        lines.push(isEnglish 
          ? "# No collections found"
          : "# 未找到集合");
      }
    } else {
      lines.push(isEnglish 
        ? "# Collections require API access"
        : "# 集合列表需要 API 访问权限");
    }
  } else {
    lines.push(isEnglish 
      ? "# Collections exposure is disabled" 
      : "# 未开启集合页暴露");
  }
  lines.push("");

  // === Blogs Section ===
  if (settings.exposurePreferences.exposeBlogs) {
    lines.push(isEnglish ? "## Blog & Content" : "## 博客与内容");
    if (admin) {
      if (articles.length > 0) {
        lines.push("articles:");
        articles.forEach(({ url, title }) => {
          lines.push(`  - url: ${url}`);
          lines.push(`    title: ${yamlValue(title)}`);
        });
      } else {
        lines.push(isEnglish 
          ? "# No blog articles found"
          : "# 未找到博客文章");
      }
    } else {
      lines.push(isEnglish 
        ? "# Blog articles require API access"
        : "# 博客列表需要 API 访问权限");
    }
  } else {
    lines.push(isEnglish 
      ? "# Blog exposure is disabled" 
      : "# 未开启博客页暴露");
  }
  lines.push("");

  // === FAQ Section (New) ===
  if (includeFAQs && settings.exposurePreferences.exposeProducts) {
    lines.push(isEnglish ? "## Common Questions (Templates - Please Customize)" : "## 常见问题（模板 - 请根据实际情况修改）");
    lines.push(isEnglish 
      ? "# IMPORTANT: These are template answers. Please update them to match your actual store policies."
      : "# 重要提示：以下为模板答案，请根据您店铺的实际政策进行修改。");
    lines.push("");
    lines.push("faqs:");
    
    // Generate template FAQs with clear indicators that they need customization
    const faqs = [
      {
        q: isEnglish ? "What payment methods do you accept?" : "你们接受哪些付款方式？",
        a: isEnglish 
          ? "[CUSTOMIZE] We accept [list your actual payment methods]. Please update this answer."
          : "[请修改] 我们接受 [请填写您实际支持的支付方式]。请更新此答案。",
      },
      {
        q: isEnglish ? "What is your shipping policy?" : "你们的发货政策是什么？",
        a: isEnglish
          ? "[CUSTOMIZE] We ship within [X] business days. [Add your actual shipping details]."
          : "[请修改] 我们在 [X] 个工作日内发货。[请添加您的实际发货详情]",
      },
      {
        q: isEnglish ? "What is your return policy?" : "你们的退换货政策是什么？",
        a: isEnglish
          ? "[CUSTOMIZE] We offer returns within [X] days. [Add your actual return policy details]."
          : "[请修改] 我们提供 [X] 天内退换货服务。[请添加您的实际退换货政策]",
      },
      {
        q: isEnglish ? "How can I contact customer support?" : "如何联系客服？",
        a: isEnglish
          ? "[CUSTOMIZE] Contact us at [your email] or [your phone]. [Add your actual contact info]."
          : "[请修改] 请通过 [您的邮箱] 或 [您的电话] 联系我们。[请添加您的实际联系方式]",
      },
    ];
    
    for (const faq of faqs) {
      lines.push(`  - question: "${faq.q}"`);
      lines.push(`    answer: "${faq.a}"`);
      lines.push("");
    }
  }

  // === Store Policies Section ===
  lines.push(isEnglish ? "## Store Information" : "## 店铺信息");
  lines.push(isEnglish 
    ? "# Key pages for AI to understand store policies."
    : "# AI 了解店铺政策的关键页面。");
  lines.push("");
  lines.push("policies:");
  lines.push(`  - url: https://${shopDomain}/policies/shipping-policy`);
  lines.push(`    type: shipping`);
  lines.push(`  - url: https://${shopDomain}/policies/refund-policy`);
  lines.push(`    type: returns`);
  lines.push(`  - url: https://${shopDomain}/policies/privacy-policy`);
  lines.push(`    type: privacy`);
  lines.push(`  - url: https://${shopDomain}/pages/contact-us`);
  lines.push(`    type: contact`);
  lines.push("");

  // === Footer ===
  lines.push("---");
  lines.push(isEnglish 
    ? "# Note: This file is for AI platform reference. Content discovery is not guaranteed."
    : "# 说明：本文件仅供 AI 平台参考，不保证内容被收录。");
  lines.push(isEnglish
    ? "# Generated by AI Channel Copilot · https://github.com/..."
    : "# 由 AI Channel Copilot 生成");
  lines.push(`# Last updated: ${new Date().toISOString()}`);

  return lines.join("\n");
};

/**
 * Get cached llms.txt content for a shop
 * Returns null if cache is expired or doesn't exist
 */
export const getLlmsTxtCache = async (
  shopDomain: string,
): Promise<{ text: string; cachedAt: Date } | null> => {
  if (!shopDomain) return null;

  const platform = getPlatform();

  try {
    const record = await prisma.shopSettings.findUnique({
      where: { shopDomain_platform: { shopDomain, platform } },
      select: { llmsTxtCache: true, llmsTxtCachedAt: true },
    });

    if (!record?.llmsTxtCache || !record?.llmsTxtCachedAt) {
      return null;
    }

    // Check if cache is expired
    const cachedAt = new Date(record.llmsTxtCachedAt);
    const now = new Date();
    if (now.getTime() - cachedAt.getTime() > LLMS_CACHE_TTL_MS) {
      return null;
    }

    return {
      text: record.llmsTxtCache,
      cachedAt,
    };
  } catch (error) {
    logger.warn("[llms] Failed to get cache", { shopDomain }, {
      error: (error as Error).message,
    });
    return null;
  }
};

/**
 * Update llms.txt cache for a shop
 * Includes cooldown check to prevent concurrent updates
 */
export const updateLlmsTxtCache = async (
  shopDomain: string,
  text: string,
): Promise<{ updated: boolean; reason?: string }> => {
  if (!shopDomain) return { updated: false, reason: "no_shop" };

  const platform = getPlatform();

  try {
    // 先检查上次更新时间，避免频繁更新
    const existing = await prisma.shopSettings.findUnique({
      where: { shopDomain_platform: { shopDomain, platform } },
      select: { llmsTxtCachedAt: true },
    });

    if (existing?.llmsTxtCachedAt) {
      const timeSinceLastUpdate = Date.now() - existing.llmsTxtCachedAt.getTime();
      if (timeSinceLastUpdate < LLMS_CACHE_UPDATE_COOLDOWN_MS) {
        logger.debug("[llms] Cache update skipped (cooldown)", { 
          shopDomain, 
          timeSinceLastUpdate,
          cooldownMs: LLMS_CACHE_UPDATE_COOLDOWN_MS,
        });
        return { updated: false, reason: "cooldown" };
      }
    }

    await prisma.shopSettings.update({
      where: { shopDomain_platform: { shopDomain, platform } },
      data: {
        llmsTxtCache: text,
        llmsTxtCachedAt: new Date(),
      },
    });
    logger.info("[llms] Cache updated", { shopDomain });
    return { updated: true };
  } catch (error) {
    logger.warn("[llms] Failed to update cache", { shopDomain }, {
      error: (error as Error).message,
    });
    return { updated: false, reason: "error" };
  }
};
