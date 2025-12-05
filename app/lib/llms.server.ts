import prisma from "../db.server";
import { resolveDateRange, type TimeRangeKey } from "./aiData";
import { createGraphqlSdk, type AdminGraphqlClient } from "./graphqlSdk.server";
import { logger } from "./logger.server";
import { getPlatform } from "./runtime.server";

// Cache TTL in milliseconds (1 hour)
const LLMS_CACHE_TTL_MS = 60 * 60 * 1000;

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
  },
) => {
  const rangeKey = options?.range || "30d";
  const range = resolveDateRange(rangeKey, new Date());
  const topN = options?.topN || 10;
  const admin = options?.admin;
  const lines: string[] = [];
  const language = (settings.languages && settings.languages[0]) || "中文";

  if (language === "English") {
    lines.push("# llms.txt · AI crawling preferences (experimental)");
    lines.push("# This file only guides AI platforms on crawl scope; no guarantee of compliance or immediacy.");
  } else {
    lines.push("# llms.txt · AI 采集偏好声明（实验性）");
    lines.push("# 本文件仅用于指引 AI 平台抓取范围；不保证平台遵守或立即生效。");
  }
  lines.push("");
  if (language === "English") {
    lines.push(`# Site: shop=${shopDomain} · primary_currency=${settings.primaryCurrency || "USD"}`);
    const englishRange = rangeKey === "7d" ? "Last 7 days" : rangeKey === "30d" ? "Last 30 days" : rangeKey === "90d" ? "Last 90 days" : range.label;
    lines.push(`# Time Range: ${englishRange} · Top list based on recent AI GMV/orders`);
  } else {
    lines.push(`# 站点声明：shop=${shopDomain} · primary_currency=${settings.primaryCurrency || "USD"}`);
    lines.push(`# 时间范围：${range.label} · 依据最近 AI GMV/订单生成 Top 列表`);
  }
  lines.push("");

  // === Products Section ===
  if (settings.exposurePreferences.exposeProducts) {
    lines.push(language === "English" ? "## Products (Top by AI GMV)" : "## 产品页（按 AI GMV 排序）");
    const rows = await prisma.orderProduct.findMany({
      where: { order: { shopDomain, aiSource: { not: null }, createdAt: { gte: range.start, lte: range.end } } },
      select: { url: true, price: true, quantity: true },
    });
    const agg = new Map<string, { gmv: number }>();
    for (const r of rows) {
      const url = r.url || "";
      if (!url) continue;
      const gmv = (r.price || 0) * (r.quantity || 0);
      const prev = agg.get(url)?.gmv || 0;
      agg.set(url, { gmv: prev + gmv });
    }
    const top = Array.from(agg.entries())
      .sort((a, b) => b[1].gmv - a[1].gmv)
      .slice(0, topN)
      .map(([url]) => url);
    
    if (top.length > 0) {
      lines.push("allow:");
      top.forEach((url) => lines.push(`  - ${url}`));
    } else {
      lines.push(language === "English" 
        ? "# No AI-driven product data found in the selected time range"
        : "# 所选时间范围内未找到 AI 驱动的产品数据");
    }
  } else {
    lines.push(language === "English" ? "# Product page exposure is disabled (exposeProducts=false)" : "# 未开启产品页暴露（exposeProducts=false）");
  }
  lines.push("");

  // === Collections Section ===
  if (settings.exposurePreferences.exposeCollections) {
    lines.push(language === "English" ? "## Collections" : "## 集合/分类页");
    if (admin) {
      const collections = await fetchCollections(admin, shopDomain, topN);
      if (collections.length > 0) {
        lines.push("allow:");
        collections.forEach(({ url }) => lines.push(`  - ${url}`));
      } else {
        lines.push(language === "English" 
          ? "# No collections found or API access unavailable"
          : "# 未找到集合或 API 访问不可用");
      }
    } else {
      lines.push(language === "English" 
        ? "# Collections require API access (preview mode)"
        : "# 集合列表需要 API 访问权限（预览模式）");
    }
  } else {
    lines.push(language === "English" ? "# Collections exposure is disabled (exposeCollections=false)" : "# 未开启集合页暴露（exposeCollections=false）");
  }
  lines.push("");

  // === Blogs Section ===
  if (settings.exposurePreferences.exposeBlogs) {
    lines.push(language === "English" ? "## Blog Articles" : "## 博客文章");
    if (admin) {
      const articles = await fetchArticles(admin, shopDomain, topN);
      if (articles.length > 0) {
        lines.push("allow:");
        articles.forEach(({ url }) => lines.push(`  - ${url}`));
      } else {
        lines.push(language === "English" 
          ? "# No blog articles found or API access unavailable"
          : "# 未找到博客文章或 API 访问不可用");
      }
    } else {
      lines.push(language === "English" 
        ? "# Blog articles require API access (preview mode)"
        : "# 博客列表需要 API 访问权限（预览模式）");
    }
  } else {
    lines.push(language === "English" ? "# Blog/content exposure is disabled (exposeBlogs=false)" : "# 未开启博客页暴露（exposeBlogs=false）");
  }

  lines.push("");
  lines.push(language === "English" ? "# Scope: for AI platform reference only; no guarantee of search/ranking changes; watch for policy updates." : "# 使用范围说明：仅作为 AI 平台参考，不保证搜索/排名变化；请留意各平台策略更新。");

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
 */
export const updateLlmsTxtCache = async (
  shopDomain: string,
  text: string,
): Promise<void> => {
  if (!shopDomain) return;

  const platform = getPlatform();

  try {
    await prisma.shopSettings.update({
      where: { shopDomain_platform: { shopDomain, platform } },
      data: {
        llmsTxtCache: text,
        llmsTxtCachedAt: new Date(),
      },
    });
    logger.info("[llms] Cache updated", { shopDomain });
  } catch (error) {
    logger.warn("[llms] Failed to update cache", { shopDomain }, {
      error: (error as Error).message,
    });
  }
};
