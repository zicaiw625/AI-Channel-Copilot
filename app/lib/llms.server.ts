import prisma from "../db.server";
import { resolveDateRange, type SettingsDefaults, type TimeRangeKey } from "./aiData";
import { createGraphqlSdk, type AdminGraphqlClient } from "./graphqlSdk.server";
import { logger } from "./logger.server";
import { getPlatform } from "./runtime.server";
import { LLMS_CACHE_TTL_MS, LLMS_CACHE_UPDATE_COOLDOWN_MS } from "./constants";
import { saveSettings } from "./settings.server";

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
// Note: Collection type does not have onlineStoreUrl field in Shopify Admin API
const COLLECTIONS_QUERY = `#graphql
  query CollectionsForLlms($first: Int!) {
    collections(first: $first, sortKey: UPDATED_AT, reverse: true) {
      edges {
        node {
          id
          title
          handle
          productsCount {
            count
          }
        }
      }
    }
  }
`;

// GraphQL query for fetching blog articles
// Note: Article type does not have onlineStoreUrl field in Shopify Admin API
const ARTICLES_QUERY = `#graphql
  query ArticlesForLlms($first: Int!) {
    articles(first: $first, sortKey: UPDATED_AT, reverse: true) {
      edges {
        node {
          id
          title
          handle
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
  productsCount?: { count: number };
};

type ArticleNode = {
  id: string;
  title: string;
  handle: string;
  blog?: { handle: string };
};

/** Result type for fetch functions that includes error status */
type FetchResult<T> = {
  data: T[];
  error?: "permission_denied" | "api_error" | "unknown";
};

export type LlmsStatus = "not_configured" | "ready_to_sync" | "active" | "partial" | "error";

type LlmsSettings = SettingsDefaults;

/**
 * Fetch collections from Shopify API
 */
export const fetchCollections = async (
  admin: AdminGraphqlClient,
  shopDomain: string,
  limit: number = 20,
): Promise<FetchResult<{ url: string; title: string }>> => {
  try {
    const sdk = createGraphqlSdk(admin, shopDomain);
    const response = await sdk.request("collectionsForLlms", COLLECTIONS_QUERY, { first: limit });
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      logger.warn("[llms] Failed to fetch collections", { shopDomain, status: response.status, error: errorText });
      return { data: [], error: "api_error" };
    }
    
    const json = (await response.json()) as {
      data?: { collections?: { edges: { node: CollectionNode }[] } };
      errors?: Array<{ message: string; extensions?: { code?: string } }>;
    };
    
    // Check for permission/access errors
    if (json.errors && json.errors.length > 0) {
      const hasAccessDenied = json.errors.some(e => 
        e.message.includes("ACCESS_DENIED") || 
        e.extensions?.code === "ACCESS_DENIED" ||
        e.message.toLowerCase().includes("access") ||
        e.message.toLowerCase().includes("permission")
      );
      
      if (hasAccessDenied) {
        logger.warn("[llms] Collections query access denied", { shopDomain });
        return { data: [], error: "permission_denied" };
      }
      
      logger.warn("[llms] GraphQL errors in collections query", { shopDomain }, {
        errors: json.errors.map(e => e.message).join(", "),
      });
    }
    
    const collections = json.data?.collections?.edges || [];
    logger.info("[llms] Fetched collections", { shopDomain, count: collections.length });
    
    const result = collections
      .map(({ node }) => ({
        url: `https://${shopDomain}/collections/${node.handle}`,
        title: node.title,
      }))
      .filter((c) => c.url);
    
    return { data: result };
  } catch (error) {
    logger.error("[llms] Error fetching collections", { shopDomain }, { error: (error as Error).message });
    return { data: [], error: "unknown" };
  }
};

/**
 * Fetch blog articles from Shopify API
 * 
 * Note: Requires `read_content` or `read_online_store_pages` scope
 */
export const fetchArticles = async (
  admin: AdminGraphqlClient,
  shopDomain: string,
  limit: number = 20,
): Promise<FetchResult<{ url: string; title: string }>> => {
  try {
    const sdk = createGraphqlSdk(admin, shopDomain);
    const response = await sdk.request("articlesForLlms", ARTICLES_QUERY, { first: limit });
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      logger.warn("[llms] Failed to fetch articles", { shopDomain, status: response.status, error: errorText });
      return { data: [], error: "api_error" };
    }
    
    const json = (await response.json()) as {
      data?: { articles?: { edges: { node: ArticleNode }[] } };
      errors?: Array<{ message: string; extensions?: { code?: string } }>;
    };
    
    // Check for permission/access errors (read_content scope required)
    if (json.errors && json.errors.length > 0) {
      const hasAccessDenied = json.errors.some(e => 
        e.message.includes("ACCESS_DENIED") || 
        e.extensions?.code === "ACCESS_DENIED" ||
        e.message.toLowerCase().includes("access") ||
        e.message.toLowerCase().includes("permission")
      );
      
      if (hasAccessDenied) {
        logger.warn("[llms] Articles query requires read_content scope", { shopDomain });
        return { data: [], error: "permission_denied" };
      }
      
      logger.warn("[llms] GraphQL errors in articles query", { shopDomain }, { 
        errors: json.errors.map(e => e.message).join(", "),
      });
    }
    
    const articles = json.data?.articles?.edges || [];
    logger.info("[llms] Fetched articles", { shopDomain, count: articles.length });
    
    const result = articles
      .map(({ node }) => ({
        url: node.blog?.handle 
          ? `https://${shopDomain}/blogs/${node.blog.handle}/${node.handle}`
          : `https://${shopDomain}/blogs/news/${node.handle}`,
        title: node.title,
      }))
      .filter((a) => a.url);
    
    return { data: result };
  } catch (error) {
    logger.error("[llms] Error fetching articles", { shopDomain }, { error: (error as Error).message });
    return { data: [], error: "unknown" };
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

// GraphQL query for fetching recent products as fallback (when no AI order data)
const RECENT_PRODUCTS_QUERY = `#graphql
  query RecentProductsForLlms($first: Int!) {
    products(first: $first, sortKey: UPDATED_AT, reverse: true) {
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

/**
 * Fetch recent products from Shopify as fallback when no AI order data exists
 * Used to ensure llms.txt always has some product data for AI crawlers
 */
async function fetchRecentProductsAsFallback(
  admin: AdminGraphqlClient,
  shopDomain: string,
  limit: number = 20,
): Promise<ProductForLlms[]> {
  if (!admin) return [];
  
  try {
    const sdk = createGraphqlSdk(admin, shopDomain);
    const response = await sdk.request("recentProductsForLlms", RECENT_PRODUCTS_QUERY, { first: limit });
    
    if (!response.ok) {
      logger.warn("[llms] Failed to fetch recent products fallback", { shopDomain, status: response.status });
      return [];
    }
    
    const json = await response.json() as {
      data?: { products?: { edges: { node: ProductForLlms }[] } };
    };
    
    const products = json.data?.products?.edges?.map(({ node }) => node) || [];
    logger.info("[llms] Fetched recent products as fallback", { shopDomain, count: products.length });
    return products;
  } catch (error) {
    logger.error("[llms] Error fetching recent products fallback", { shopDomain }, {
      error: (error as Error).message,
    });
    return [];
  }
}

export const buildLlmsTxt = async (
  shopDomain: string,
  settings: LlmsSettings,
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
  // FAQ templates should never leak into the live/public llms.txt unless explicitly requested.
  const includeFAQs = options?.includeFAQs ?? false;
  const lines: string[] = [];
  const language = (settings.languages && settings.languages[0]) || "English";
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
      // Prisma Decimal 不能直接参与算术运算（TS2362），这里显式转为 number
      const price = Number(r.price);
      const qty = r.quantity ?? 0;
      const gmv = (Number.isFinite(price) ? price : 0) * qty;
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
      // 🔧 Fallback: 没有 AI 订单数据时，从 Shopify 拉取最近更新的产品
      // 这样确保 llms.txt 总是有产品数据供 AI 爬虫发现
      const fallbackProducts = admin ? await fetchRecentProductsAsFallback(admin, shopDomain, topN) : [];
      
      if (fallbackProducts.length > 0) {
        lines.push(isEnglish 
          ? "# Recent products (no AI-driven sales data yet)"
          : "# 最近更新产品（暂无 AI 驱动的销售数据）");
        lines.push("");
        lines.push("products:");
        for (const product of fallbackProducts) {
          const url = product.onlineStoreUrl || `https://${shopDomain}/products/${product.handle}`;
          lines.push(`  - url: ${url}`);
          lines.push(`    title: ${yamlValue(product.title)}`);
          
          // Add price if available
          if (product.priceRangeV2?.minVariantPrice) {
            const price = product.priceRangeV2.minVariantPrice;
            lines.push(`    price: ${yamlValue(`${price.amount} ${price.currencyCode}`)}`);
          }
          
          // Add description summary (first 150 chars)
          if (product.description) {
            const rawSummary = product.description
              .replace(/[\n\r]+/g, " ")
              .trim()
              .slice(0, 150);
            if (rawSummary) {
              const suffix = product.description.length > 150 ? "..." : "";
              lines.push(`    summary: ${yamlValue(rawSummary + suffix)}`);
            }
          }
          
          // Add category/type
          if (product.productType) {
            lines.push(`    category: ${yamlValue(product.productType)}`);
          }
          
          // Add vendor/brand
          if (product.vendor) {
            lines.push(`    brand: ${yamlValue(product.vendor)}`);
          }
          
          lines.push("");
        }
      } else {
        lines.push(isEnglish 
          ? "# No products found"
          : "# 未找到产品");
      }
    }
  } else {
    lines.push(isEnglish 
      ? "# Product exposure is disabled (exposeProducts=false)" 
      : "# 未开启产品页暴露（exposeProducts=false）");
  }
  lines.push("");

  // === Fetch collections and articles in parallel for better performance ===
  const [collectionsResult, articlesResult] = await Promise.all([
    settings.exposurePreferences.exposeCollections && admin
      ? fetchCollections(admin, shopDomain, topN)
      : Promise.resolve({ data: [] } as FetchResult<{ url: string; title: string }>),
    settings.exposurePreferences.exposeBlogs && admin
      ? fetchArticles(admin, shopDomain, topN)
      : Promise.resolve({ data: [] } as FetchResult<{ url: string; title: string }>),
  ]);

  // === Collections Section ===
  if (settings.exposurePreferences.exposeCollections) {
    lines.push(isEnglish ? "## Collections" : "## 产品集合");
    if (admin) {
      if (collectionsResult.data.length > 0) {
        lines.push("collections:");
        collectionsResult.data.forEach(({ url, title }) => {
          lines.push(`  - url: ${url}`);
          lines.push(`    title: ${yamlValue(title)}`);
        });
      } else if (collectionsResult.error === "permission_denied") {
        lines.push(isEnglish 
          ? "# Permission denied - please re-authorize the app"
          : "# 权限不足 - 请重新授权应用");
      } else if (collectionsResult.error) {
        lines.push(isEnglish 
          ? "# Failed to fetch collections (API error)"
          : "# 获取集合失败（API 错误）");
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
      if (articlesResult.data.length > 0) {
        lines.push("articles:");
        articlesResult.data.forEach(({ url, title }) => {
          lines.push(`  - url: ${url}`);
          lines.push(`    title: ${yamlValue(title)}`);
        });
      } else if (articlesResult.error === "permission_denied") {
        // 🔧 修复：明确提示需要重新授权（scope 变更后需要重新 grant）
        lines.push(isEnglish 
          ? "# Permission denied - read_content scope required. Please re-install or re-authorize the app."
          : "# 权限不足 - 需要 read_content 权限。请重新安装或重新授权应用。");
      } else if (articlesResult.error) {
        lines.push(isEnglish 
          ? "# Failed to fetch articles (API error)"
          : "# 获取博客文章失败（API 错误）");
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
      lines.push(`  - question: ${yamlValue(faq.q)}`);
      lines.push(`    answer: ${yamlValue(faq.a)}`);
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
    ? "# Generated by AI SEO & Discovery · https://github.com/..."
    : "# 由 AI SEO & Discovery 生成");
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
 * Includes cooldown check to prevent concurrent updates (can be bypassed with force=true)
 * 
 * @param shopDomain - The shop domain
 * @param text - The llms.txt content to cache
 * @param options - Optional settings
 * @param options.force - If true, bypass cooldown check (use for user-initiated saves)
 */
export const updateLlmsTxtCache = async (
  shopDomain: string,
  text: string,
  options?: { force?: boolean },
): Promise<{ updated: boolean; reason?: string }> => {
  if (!shopDomain) return { updated: false, reason: "no_shop" };

  const platform = getPlatform();
  const force = options?.force ?? false;

  try {
    // 先检查上次更新时间，避免频繁更新（除非强制更新）
    if (!force) {
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
    }

    await prisma.shopSettings.update({
      where: { shopDomain_platform: { shopDomain, platform } },
      data: {
        llmsTxtCache: text,
        llmsTxtCachedAt: new Date(),
      },
    });
    logger.info("[llms] Cache updated", { shopDomain, forced: force });
    return { updated: true };
  } catch (error) {
    logger.warn("[llms] Failed to update cache", { shopDomain }, {
      error: (error as Error).message,
    });
    return { updated: false, reason: "error" };
  }
};

export const getLlmsStatus = async (
  shopDomain: string,
  settings: LlmsSettings,
): Promise<{
  status: LlmsStatus;
  publicUrl: string;
  cachedAt: Date | null;
  hasExposure: boolean;
}> => {
  const publicUrl = shopDomain ? `https://${shopDomain}/a/llms` : "";
  const hasExposure =
    settings.exposurePreferences.exposeProducts ||
    settings.exposurePreferences.exposeCollections ||
    settings.exposurePreferences.exposeBlogs;

  if (!shopDomain) {
    return { status: "error", publicUrl, cachedAt: null, hasExposure };
  }

  if (!hasExposure) {
    return { status: "not_configured", publicUrl, cachedAt: null, hasExposure };
  }

  const platform = getPlatform();

  try {
    const record = await prisma.shopSettings.findUnique({
      where: { shopDomain_platform: { shopDomain, platform } },
      select: { llmsTxtCache: true, llmsTxtCachedAt: true },
    });

    const cachedAt = record?.llmsTxtCachedAt ? new Date(record.llmsTxtCachedAt) : null;

    if (!record?.llmsTxtCache || !cachedAt) {
      return { status: "ready_to_sync", publicUrl, cachedAt: null, hasExposure };
    }

    const isFresh = Date.now() - cachedAt.getTime() <= LLMS_CACHE_TTL_MS;

    return {
      status: isFresh ? "active" : "partial",
      publicUrl,
      cachedAt,
      hasExposure,
    };
  } catch (error) {
    logger.warn("[llms] Failed to resolve status", { shopDomain }, {
      error: (error as Error).message,
    });
    return { status: "error", publicUrl, cachedAt: null, hasExposure };
  }
};

export const syncLlmsTxt = async (
  shopDomain: string,
  admin: AdminGraphqlClient,
  settings: LlmsSettings,
  options?: {
    range?: TimeRangeKey;
    topN?: number;
    persistSettings?: boolean;
    autoEnableProducts?: boolean;
  },
): Promise<{
  text: string;
  status: LlmsStatus;
  publicUrl: string;
  cachedAt: Date | null;
  hasExposure: boolean;
  settings: LlmsSettings;
  updated: boolean;
  reason?: string;
  autoEnabledProducts: boolean;
}> => {
  let nextSettings = settings;
  let autoEnabledProducts = false;
  const hasExposure =
    settings.exposurePreferences.exposeProducts ||
    settings.exposurePreferences.exposeCollections ||
    settings.exposurePreferences.exposeBlogs;

  if (!hasExposure && options?.autoEnableProducts !== false) {
    nextSettings = {
      ...settings,
      exposurePreferences: {
        ...settings.exposurePreferences,
        exposeProducts: true,
      },
    };
    autoEnabledProducts = true;
    if (options?.persistSettings !== false) {
      await saveSettings(shopDomain, nextSettings);
    }
  }

  const text = await buildLlmsTxt(shopDomain, nextSettings, {
    range: options?.range || "30d",
    topN: options?.topN || 20,
    admin,
  });
  const cacheResult = await updateLlmsTxtCache(shopDomain, text, { force: true });
  const statusInfo = await getLlmsStatus(shopDomain, nextSettings);

  return {
    text,
    status: statusInfo.status,
    publicUrl: statusInfo.publicUrl,
    cachedAt: statusInfo.cachedAt,
    hasExposure: statusInfo.hasExposure,
    settings: nextSettings,
    updated: cacheResult.updated,
    reason: cacheResult.reason,
    autoEnabledProducts,
  };
};
