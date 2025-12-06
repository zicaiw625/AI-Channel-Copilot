import { defaultSettings, mapShopifyOrderToRecord, type DateRange, type OrderRecord, type SettingsDefaults, type ShopifyOrderNode } from "./aiData";
import { getPlatform, isDemoMode } from "./runtime.server";
import { createGraphqlSdk, type AdminGraphqlClient } from "./graphqlSdk.server";
import {
  MAX_BACKFILL_DAYS,
  MAX_BACKFILL_DURATION_MS,
  MAX_BACKFILL_ORDERS,
} from "./constants";
import { logger } from "./logger.server";

// 订单查询的核心字段片段（不含 noteAttributes）
const ORDER_CORE_FIELDS = `
        id
        name
        createdAt
        currentTotalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        currentSubtotalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        totalRefundedSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        landingPageUrl
        customerJourneySummary {
          firstVisit {
            referrerUrl
          }
        }
        sourceName
        tags
        customer {
          id
          numberOfOrders
        }
        lineItems(first: 50) {
            edges {
              node {
                id
                quantity
                name
                originalUnitPriceSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
                variant {
                  product {
                    id
                    legacyResourceId
                    title
                    handle
                    onlineStoreUrl
                  }
                }
              }
            }
          }
`;

// 完整查询（包含 noteAttributes）
const ORDERS_QUERY = `#graphql
  query OrdersForAiDashboard($first: Int!, $after: String, $query: String!) {
    orders(first: $first, after: $after, query: $query, reverse: true, sortKey: CREATED_AT) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
      node {
        ${ORDER_CORE_FIELDS}
        noteAttributes {
          name
          value
        }
        }
      }
    }
  }
`;

// 备用查询（不含 noteAttributes，用于某些 API 版本或商店类型）
const ORDERS_QUERY_FALLBACK = `#graphql
  query OrdersForAiDashboard($first: Int!, $after: String, $query: String!) {
    orders(first: $first, after: $after, query: $query, reverse: true, sortKey: CREATED_AT) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
      node {
        ${ORDER_CORE_FIELDS}
        }
      }
    }
  }
`;

const ORDER_QUERY = `#graphql
  query OrderForAiDashboard($id: ID!) {
    order(id: $id) {
      ${ORDER_CORE_FIELDS}
      noteAttributes {
        name
        value
      }
    }
  }
`;

// 备用单订单查询（不含 noteAttributes）
const ORDER_QUERY_FALLBACK = `#graphql
  query OrderForAiDashboard($id: ID!) {
    order(id: $id) {
      ${ORDER_CORE_FIELDS}
    }
  }
`;

/**
 * 简单的 TTL 缓存，用于追踪需要降级查询的店铺
 * 防止无限增长导致内存泄漏
 */
class TTLCache<K, V> {
  private cache = new Map<K, { value: V; expiresAt: number }>();
  private maxSize: number;
  private ttlMs: number;

  constructor(options: { maxSize?: number; ttlMs?: number } = {}) {
    this.maxSize = options.maxSize ?? 1000;
    this.ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000; // 默认 24 小时
  }

  set(key: K, value: V): void {
    // 清理过期条目
    this.cleanup();
    
    // 如果达到最大容量，删除最旧的条目
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }
    
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    
    return entry.value;
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  // 用于调试和监控
  get size(): number {
    this.cleanup();
    return this.cache.size;
  }
}

// Track shops that need fallback queries (noteAttributes not available)
// Using TTL cache to prevent memory leaks and allow recovery if API changes
const shopsFallbackOrders = new TTLCache<string, boolean>({ 
  maxSize: 1000, 
  ttlMs: 24 * 60 * 60 * 1000, // 24 小时后重试完整查询
});
const shopsFallbackSingleOrder = new TTLCache<string, boolean>({ 
  maxSize: 1000, 
  ttlMs: 24 * 60 * 60 * 1000,
});

const shouldUseFallbackQuery = (shopDomain: string | undefined, type: "orders" | "single"): boolean => {
  if (!shopDomain) return false;
  return type === "orders" 
    ? shopsFallbackOrders.has(shopDomain) 
    : shopsFallbackSingleOrder.has(shopDomain);
};

const markShopNeedsFallback = (shopDomain: string | undefined, type: "orders" | "single"): void => {
  if (!shopDomain) return;
  if (type === "orders") {
    shopsFallbackOrders.set(shopDomain, true);
  } else {
    shopsFallbackSingleOrder.set(shopDomain, true);
  }
};


const MAX_BACKFILL_PAGES = 20;
const DEFAULT_GRAPHQL_TIMEOUT_MS = 4500;

const platform = getPlatform();

// 检查 GraphQL 错误是否与 noteAttributes 字段相关
const isNoteAttributesError = (errors: unknown): boolean => {
  if (!errors) return false;
  const errStr = JSON.stringify(errors);
  return errStr.includes("noteAttributes") && errStr.includes("doesn't exist");
};

const fetchOrdersPage = async (
  admin: AdminGraphqlClient,
  query: string,
  after: string | undefined,
  context: FetchContext,
) => {
  const sdk = createGraphqlSdk(admin, context.shopDomain);
  const shopDomain = context.shopDomain;
  
  // 选择使用的查询（完整版或备用版）- per shop
  const useFallback = shouldUseFallbackQuery(shopDomain, "orders");
  const ordersQuery = useFallback ? ORDERS_QUERY_FALLBACK : ORDERS_QUERY;
  
  const response = await sdk.request("orders query", ordersQuery, { first: 50, after, query }, { timeoutMs: DEFAULT_GRAPHQL_TIMEOUT_MS });
  if (!response.ok) {
    const text = await response.text();
    logger.error("[backfill] orders page fetch failed", {
      platform,
      shopDomain: context?.shopDomain,
      jobType: "backfill",
      intent: context?.intent,
    }, { status: response.status, body: text });
    throw new Error(`Orders query failed: ${response.status}`);
  }

  const json = (await response.json()) as {
    data?: {
      orders?: {
        pageInfo: { hasNextPage: boolean; endCursor?: string | null };
        edges: { node: ShopifyOrderNode }[];
      };
    };
    errors?: unknown;
  };
  
  if (json.errors) {
    // 检查是否是 noteAttributes 字段不存在的错误
    if (!useFallback && isNoteAttributesError(json.errors)) {
      logger.warn("[backfill] noteAttributes field not available, switching to fallback query", {
        platform,
        shopDomain: context?.shopDomain,
        jobType: "backfill",
        intent: context?.intent,
      });
      markShopNeedsFallback(shopDomain, "orders");
      // 使用备用查询重试
      return fetchOrdersPage(admin, query, after, context);
    }
    
    logger.error("[backfill] orders page GraphQL errors", {
      platform,
      shopDomain: context?.shopDomain,
      jobType: "backfill",
      intent: context?.intent,
    }, { errors: json.errors });
    throw new Error("Orders query returned GraphQL errors");
  }
  return json;
};

type FetchContext = {
  shopDomain?: string;
  intent?: string;
  rangeLabel?: string;
};

export const fetchOrdersForRange = async (
  admin: AdminGraphqlClient,
  range: DateRange,
  settings: SettingsDefaults = defaultSettings,
  context?: FetchContext,
  options?: { maxOrders?: number; maxDurationMs?: number },
): Promise<{
  orders: OrderRecord[];
  start: Date;
  end: Date;
  clamped: boolean;
  pageCount: number;
  hitPageLimit: boolean;
  hitOrderLimit: boolean;
  hitDurationLimit: boolean;
}> => {
  if (isDemoMode()) {
    logger.info("[backfill] demo mode enabled; skipping Shopify fetch", {
      platform,
      shopDomain: context?.shopDomain,
      intent: context?.intent,
      jobType: "backfill",
    });
    return {
      orders: [],
      start: range.start,
      end: range.end,
      clamped: false,
      pageCount: 0,
      hitPageLimit: false,
      hitOrderLimit: false,
      hitDurationLimit: false,
    };
  }

  const maxOrders = options?.maxOrders ?? MAX_BACKFILL_ORDERS;
  const maxDuration = options?.maxDurationMs ?? MAX_BACKFILL_DURATION_MS;
  const lowerBound = new Date();
  lowerBound.setUTCDate(lowerBound.getUTCDate() - MAX_BACKFILL_DAYS);
  lowerBound.setUTCHours(0, 0, 0, 0);
  const effectiveStart = range.start < lowerBound ? lowerBound : range.start;
  const clamped = range.start < lowerBound;
  const search = `created_at:>=${effectiveStart.toISOString()} created_at:<=${range.end.toISOString()}`;
  const records: OrderRecord[] = [];

  let after: string | undefined;
  let guard = 0;
  let hitPageLimit = false;
  let hitOrderLimit = false;
  let hitDurationLimit = false;
  const startedAt = Date.now();

  logger.info("[backfill] fetching orders", {
    platform,
    shopDomain: context?.shopDomain,
    intent: context?.intent,
    range: context?.rangeLabel || `${effectiveStart.toISOString()} to ${range.end.toISOString()}`,
    jobType: "backfill",
  });
  try {
    do {
      if (Date.now() - startedAt > maxDuration) {
        hitDurationLimit = true;
        break;
      }

      const json = await fetchOrdersPage(admin, search, after, context || {});
      const page = json.data?.orders;
      if (!page) break;

      page.edges.forEach(({ node }) => {
        const record = mapShopifyOrderToRecord(node, settings);
        records.push(record);
        if (!record.aiSource || record.aiSource === "Other-AI") {
          const refDomain = (record.referrer || "").split("/")[0];
          logger.info("[attribution] non-specific AI result", {
            platform,
            shopDomain: context?.shopDomain,
            jobType: "backfill",
            intent: context?.intent,
          }, {
            referrer: record.referrer || null,
            utmSource: record.utmSource || null,
            utmMedium: record.utmMedium || null,
            detection: record.detection,
            refDomain: refDomain || null,
          });
        }
      });

      after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor || undefined : undefined;
      guard += 1;
      if (guard >= MAX_BACKFILL_PAGES || records.length >= maxOrders) {
        // Avoid runaway pagination in extreme cases.
        hitPageLimit = guard >= MAX_BACKFILL_PAGES;
        hitOrderLimit = records.length >= maxOrders;
        break;
      }
    } while (after);
  } catch (error) {
    const message = (error as Error)?.message || String(error);
    if (/not approved to access the Order object/i.test(message) || /protected customer data/i.test(message)) {
      logger.warn("[backfill] orders fetch skipped due to protected customer data access", {
        platform,
        shopDomain: context?.shopDomain,
        jobType: "backfill",
        intent: context?.intent,
      }, { message });
      // Return empty dataset gracefully so settings页面可加载
      return {
        orders: [],
        start: effectiveStart,
        end: range.end,
        clamped,
        pageCount: 0,
        hitPageLimit: false,
        hitOrderLimit: false,
        hitDurationLimit: false,
      };
    }
    throw error;
  }

  logger.info("[backfill] fetched orders", {
    platform,
    shopDomain: context?.shopDomain,
    intent: context?.intent,
    range: context?.rangeLabel || `${effectiveStart.toISOString()} to ${range.end.toISOString()}`,
    orders: records.length,
    pages: guard,
    clamped,
    hitPageLimit,
    hitOrderLimit,
    hitDurationLimit,
    maxOrders,
    maxDuration,
    jobType: "backfill",
  });

  return {
    orders: records,
    start: effectiveStart,
    end: range.end,
    clamped,
    pageCount: guard,
    hitPageLimit,
    hitOrderLimit,
    hitDurationLimit,
  };
};

export const fetchOrderById = async (
  admin: AdminGraphqlClient,
  id: string,
  settings: SettingsDefaults = defaultSettings,
  context?: FetchContext,
): Promise<OrderRecord | null> => {
  if (isDemoMode()) {
    logger.info("[webhook] demo mode enabled; skipping order fetch", { platform, id, jobType: "webhook" });
    return null;
  }

  const shopDomain = context?.shopDomain;
  const sdk = createGraphqlSdk(admin, shopDomain);
  
  // 选择使用的查询（完整版或备用版）- per shop
  const useFallback = shouldUseFallbackQuery(shopDomain, "single");
  const orderQuery = useFallback ? ORDER_QUERY_FALLBACK : ORDER_QUERY;
  
  const response = await sdk.request("order query", orderQuery, { id }, { timeoutMs: DEFAULT_GRAPHQL_TIMEOUT_MS });
  if (!response.ok) {
    const text = await response.text();
    logger.error("[webhook] order fetch failed", { platform, id, jobType: "webhook", shopDomain }, { status: response.status, body: text });
    return null;
  }

  const json = (await response.json()) as { data?: { order?: ShopifyOrderNode | null }; errors?: unknown };
  
  if (json.errors) {
    // 检查是否是 noteAttributes 字段不存在的错误
    if (!useFallback && isNoteAttributesError(json.errors)) {
      logger.warn("[webhook] noteAttributes field not available, switching to fallback query", {
        platform,
        id,
        jobType: "webhook",
        shopDomain,
      });
      markShopNeedsFallback(shopDomain, "single");
      // 使用备用查询重试
      return fetchOrderById(admin, id, settings, context);
    }
    
    logger.error("[webhook] order GraphQL errors", { platform, id, jobType: "webhook", shopDomain }, { errors: json.errors });
    return null;
  }
  if (!json.data?.order) return null;

  return mapShopifyOrderToRecord(json.data.order, settings);
};
