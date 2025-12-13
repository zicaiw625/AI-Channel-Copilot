import { defaultSettings, mapShopifyOrderToRecord, type DateRange, type OrderRecord, type SettingsDefaults, type ShopifyOrderNode } from "./aiData";
import { getPlatform, isDemoMode } from "./runtime.server";
import { createGraphqlSdk, type AdminGraphqlClient } from "./graphqlSdk.server";
import {
  MAX_BACKFILL_DAYS,
  MAX_BACKFILL_DURATION_MS,
  MAX_BACKFILL_ORDERS,
} from "./constants";
import { logger } from "./logger.server";

// 订单查询的核心字段片段（不含 noteAttributes，不含 customer）
const ORDER_BASE_FIELDS = `
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

// 完整核心字段（包含 customer，需要 Protected Customer Data 权限）
const ORDER_CORE_FIELDS = `
        ${ORDER_BASE_FIELDS}
        customer {
          id
          numberOfOrders
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

// 最小化查询（不含 noteAttributes 和 customer，用于 PCD 未获批的情况）
const ORDERS_QUERY_MINIMAL = `#graphql
  query OrdersForAiDashboard($first: Int!, $after: String, $query: String!) {
    orders(first: $first, after: $after, query: $query, reverse: true, sortKey: CREATED_AT) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
      node {
        ${ORDER_BASE_FIELDS}
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

// 最小化单订单查询（不含 noteAttributes 和 customer）
const ORDER_QUERY_MINIMAL = `#graphql
  query OrderForAiDashboard($id: ID!) {
    order(id: $id) {
      ${ORDER_BASE_FIELDS}
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

// 查询降级级别：full -> fallback (no noteAttributes) -> minimal (no customer)
type QueryLevel = "full" | "fallback" | "minimal";

// Track shops that need fallback/minimal queries
// Using TTL cache to prevent memory leaks and allow recovery if API changes
const shopsQueryLevel = new TTLCache<string, QueryLevel>({ 
  maxSize: 1000, 
  ttlMs: 24 * 60 * 60 * 1000, // 24 小时后重试完整查询
});
const shopsSingleQueryLevel = new TTLCache<string, QueryLevel>({ 
  maxSize: 1000, 
  ttlMs: 24 * 60 * 60 * 1000,
});

const getQueryLevel = (shopDomain: string | undefined, type: "orders" | "single"): QueryLevel => {
  if (!shopDomain) return "full";
  const level = type === "orders" 
    ? shopsQueryLevel.get(shopDomain) 
    : shopsSingleQueryLevel.get(shopDomain);
  return level ?? "full";
};

const setQueryLevel = (shopDomain: string | undefined, type: "orders" | "single", level: QueryLevel): void => {
  if (!shopDomain) return;
  if (type === "orders") {
    shopsQueryLevel.set(shopDomain, level);
  } else {
    shopsSingleQueryLevel.set(shopDomain, level);
  }
};

// 向后兼容的辅助函数
const shouldUseFallbackQuery = (shopDomain: string | undefined, type: "orders" | "single"): boolean => {
  const level = getQueryLevel(shopDomain, type);
  return level === "fallback" || level === "minimal";
};

const markShopNeedsFallback = (shopDomain: string | undefined, type: "orders" | "single"): void => {
  const currentLevel = getQueryLevel(shopDomain, type);
  // 只降级到 fallback，不跳过 minimal
  if (currentLevel === "full") {
    setQueryLevel(shopDomain, type, "fallback");
  }
};

const markShopNeedsMinimal = (shopDomain: string | undefined, type: "orders" | "single"): void => {
  setQueryLevel(shopDomain, type, "minimal");
};


const MAX_BACKFILL_PAGES = 20;
const DEFAULT_GRAPHQL_TIMEOUT_MS = 4500;

const platform = getPlatform();

// 检查 GraphQL 错误是否与 noteAttributes 字段相关
const isNoteAttributesError = (errors: unknown): boolean => {
  if (!errors) return false;
  const errStr = typeof errors === "string" ? errors : JSON.stringify(errors);
  const hasNoteAttributes = errStr.includes("noteAttributes");
  const hasDoesntExist = errStr.includes("doesn't exist") || 
                         errStr.includes("doesn't exist") || 
                         errStr.includes("does not exist") ||
                         errStr.toLowerCase().includes("field") && errStr.toLowerCase().includes("not exist");
  return hasNoteAttributes && hasDoesntExist;
};

// 检查是否是 customer 字段权限问题（Protected Customer Data）
const isCustomerAccessError = (errors: unknown): boolean => {
  if (!errors) return false;
  const errStr = typeof errors === "string" ? errors : JSON.stringify(errors).toLowerCase();
  return errStr.includes("customer") ||
    errStr.includes("access denied") ||
    errStr.includes("protected") ||
    errStr.includes("permission") ||
    errStr.includes("unauthorized");
};

// 根据查询级别选择查询
const getOrdersQuery = (level: QueryLevel): string => {
  switch (level) {
    case "minimal": return ORDERS_QUERY_MINIMAL;
    case "fallback": return ORDERS_QUERY_FALLBACK;
    default: return ORDERS_QUERY;
  }
};

const fetchOrdersPage = async (
  admin: AdminGraphqlClient,
  query: string,
  after: string | undefined,
  context: FetchContext,
) => {
  const sdk = createGraphqlSdk(admin, context.shopDomain);
  const shopDomain = context.shopDomain;
  
  // 选择使用的查询级别 - per shop
  const queryLevel = getQueryLevel(shopDomain, "orders");
  const ordersQuery = getOrdersQuery(queryLevel);
  
  logger.info("[backfill] fetching orders page", {
    platform,
    shopDomain: context?.shopDomain,
    queryLevel,
    intent: context?.intent,
  });
  
  let response: Response;
  try {
    response = await sdk.request("orders query", ordersQuery, { first: 50, after, query }, { timeoutMs: DEFAULT_GRAPHQL_TIMEOUT_MS });
  } catch (error) {
    const errMsg = (error as Error).message || "";
    
    // 检查是否是 noteAttributes 字段错误
    if (queryLevel === "full" && isNoteAttributesError(errMsg)) {
      logger.warn("[backfill] noteAttributes not available, downgrading to fallback", { shopDomain, platform });
      markShopNeedsFallback(shopDomain, "orders");
      return fetchOrdersPage(admin, query, after, context);
    }
    
    // 检查是否是 customer 字段权限问题
    if (queryLevel !== "minimal" && isCustomerAccessError(errMsg)) {
      logger.warn("[backfill] customer field access denied (PCD), downgrading to minimal", { shopDomain, platform, errorMsg: errMsg });
      markShopNeedsMinimal(shopDomain, "orders");
      return fetchOrdersPage(admin, query, after, context);
    }
    
    throw error;
  }
  
  if (!response.ok) {
    const text = await response.text();
    
    // 检查是否需要降级
    if (queryLevel === "full" && isNoteAttributesError(text)) {
      logger.warn("[backfill] noteAttributes not available (non-200), downgrading to fallback", { shopDomain, platform });
      markShopNeedsFallback(shopDomain, "orders");
      return fetchOrdersPage(admin, query, after, context);
    }
    
    if (queryLevel !== "minimal" && isCustomerAccessError(text)) {
      logger.warn("[backfill] customer field access denied (PCD, non-200), downgrading to minimal", { shopDomain, platform });
      markShopNeedsMinimal(shopDomain, "orders");
      return fetchOrdersPage(admin, query, after, context);
    }
    
    logger.error("[backfill] orders page fetch failed", {
      platform,
      shopDomain: context?.shopDomain,
      queryLevel,
    }, { status: response.status, body: text });
    throw new Error(`Orders query failed: ${response.status} - ${text.slice(0, 200)}`);
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
    // 提取错误详情
    const errorMessages = Array.isArray(json.errors) 
      ? json.errors.map((e: { message?: string }) => e.message || JSON.stringify(e)).join("; ")
      : JSON.stringify(json.errors);
    
    // 检查是否需要降级到 fallback
    if (queryLevel === "full" && isNoteAttributesError(json.errors)) {
      logger.warn("[backfill] noteAttributes not available, downgrading to fallback", { shopDomain, platform });
      markShopNeedsFallback(shopDomain, "orders");
      return fetchOrdersPage(admin, query, after, context);
    }
    
    // 检查是否需要降级到 minimal（PCD 问题）
    if (queryLevel !== "minimal" && isCustomerAccessError(json.errors)) {
      logger.warn("[backfill] customer field access denied (PCD), downgrading to minimal", { 
        shopDomain, 
        platform, 
        errorMessages,
      });
      markShopNeedsMinimal(shopDomain, "orders");
      return fetchOrdersPage(admin, query, after, context);
    }
    
    // 无法降级，抛出详细错误
    logger.error("[backfill] orders page GraphQL errors", {
      platform,
      shopDomain: context?.shopDomain,
      queryLevel,
      errorMessages,
    });
    throw new Error(`Orders query failed: ${errorMessages}`);
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
  
  // 格式化日期为 ISO 格式但不含毫秒，并加引号（符合 Shopify search syntax）
  const formatDateForSearch = (date: Date): string => {
    return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
  };
  const search = `created_at:>="${formatDateForSearch(effectiveStart)}" created_at:<="${formatDateForSearch(range.end)}"`;
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

// 根据查询级别选择单订单查询
const getSingleOrderQuery = (level: QueryLevel): string => {
  switch (level) {
    case "minimal": return ORDER_QUERY_MINIMAL;
    case "fallback": return ORDER_QUERY_FALLBACK;
    default: return ORDER_QUERY;
  }
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
  
  // 选择使用的查询级别 - per shop
  const queryLevel = getQueryLevel(shopDomain, "single");
  const orderQuery = getSingleOrderQuery(queryLevel);
  
  let response: Response;
  try {
    response = await sdk.request("order query", orderQuery, { id }, { timeoutMs: DEFAULT_GRAPHQL_TIMEOUT_MS });
  } catch (error) {
    const errMsg = (error as Error).message || "";
    
    // 检查是否需要降级到 fallback
    if (queryLevel === "full" && isNoteAttributesError(errMsg)) {
      logger.warn("[webhook] noteAttributes not available, downgrading to fallback", { platform, id, shopDomain });
      markShopNeedsFallback(shopDomain, "single");
      return fetchOrderById(admin, id, settings, context);
    }
    
    // 检查是否需要降级到 minimal（PCD 问题）
    if (queryLevel !== "minimal" && isCustomerAccessError(errMsg)) {
      logger.warn("[webhook] customer field access denied (PCD), downgrading to minimal", { platform, id, shopDomain, errorMsg: errMsg });
      markShopNeedsMinimal(shopDomain, "single");
      return fetchOrderById(admin, id, settings, context);
    }
    
    logger.error("[webhook] order fetch failed with exception", { platform, id, jobType: "webhook", shopDomain, queryLevel }, { error: errMsg });
    return null;
  }
  
  if (!response.ok) {
    const text = await response.text();
    
    // 检查是否需要降级
    if (queryLevel === "full" && isNoteAttributesError(text)) {
      logger.warn("[webhook] noteAttributes not available (non-200), downgrading to fallback", { platform, id, shopDomain });
      markShopNeedsFallback(shopDomain, "single");
      return fetchOrderById(admin, id, settings, context);
    }
    
    if (queryLevel !== "minimal" && isCustomerAccessError(text)) {
      logger.warn("[webhook] customer field access denied (PCD, non-200), downgrading to minimal", { platform, id, shopDomain });
      markShopNeedsMinimal(shopDomain, "single");
      return fetchOrderById(admin, id, settings, context);
    }
    
    logger.error("[webhook] order fetch failed", { platform, id, jobType: "webhook", shopDomain, queryLevel }, { status: response.status, body: text.slice(0, 200) });
    return null;
  }

  const json = (await response.json()) as { data?: { order?: ShopifyOrderNode | null }; errors?: unknown };
  
  if (json.errors) {
    const errorMessages = Array.isArray(json.errors) 
      ? json.errors.map((e: { message?: string }) => e.message || JSON.stringify(e)).join("; ")
      : JSON.stringify(json.errors);
    
    // 检查是否需要降级到 fallback
    if (queryLevel === "full" && isNoteAttributesError(json.errors)) {
      logger.warn("[webhook] noteAttributes not available, downgrading to fallback", { platform, id, shopDomain });
      markShopNeedsFallback(shopDomain, "single");
      return fetchOrderById(admin, id, settings, context);
    }
    
    // 检查是否需要降级到 minimal（PCD 问题）
    if (queryLevel !== "minimal" && isCustomerAccessError(json.errors)) {
      logger.warn("[webhook] customer field access denied (PCD), downgrading to minimal", { platform, id, shopDomain, errorMessages });
      markShopNeedsMinimal(shopDomain, "single");
      return fetchOrderById(admin, id, settings, context);
    }
    
    logger.error("[webhook] order GraphQL errors", { platform, id, jobType: "webhook", shopDomain, queryLevel, errorMessages });
    return null;
  }
  
  if (!json.data?.order) return null;

  return mapShopifyOrderToRecord(json.data.order, settings);
};
