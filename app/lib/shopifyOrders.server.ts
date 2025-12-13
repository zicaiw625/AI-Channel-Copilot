import { defaultSettings, mapShopifyOrderToRecord, type DateRange, type OrderRecord, type SettingsDefaults, type ShopifyOrderNode } from "./aiData";
import { getPlatform, isDemoMode } from "./runtime.server";
import { createGraphqlSdk, type AdminGraphqlClient } from "./graphqlSdk.server";
import {
  MAX_BACKFILL_DAYS,
  MAX_BACKFILL_DURATION_MS,
  MAX_BACKFILL_ORDERS,
  GRAPHQL_TIMEOUT_MS,
  GRAPHQL_MAX_DOWNGRADE_RETRIES,
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
        noteAttributes: customAttributes {
          name: key
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
      noteAttributes: customAttributes {
        name: key
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
 * 【优化】添加缓存命中率监控
 */
class TTLCache<K, V> {
  private cache = new Map<K, { value: V; expiresAt: number }>();
  private maxSize: number;
  private ttlMs: number;
  private name: string;
  
  // 监控指标
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(options: { maxSize?: number; ttlMs?: number; name?: string } = {}) {
    this.maxSize = options.maxSize ?? 1000;
    this.ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000; // 默认 24 小时
    this.name = options.name ?? 'ttl_cache';
  }

  set(key: K, value: V): void {
    // 清理过期条目
    this.cleanup();
    
    // 如果达到最大容量，删除最旧的条目
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
        this.evictions++;
      }
    }
    
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.misses++;
      return undefined;
    }
    
    this.hits++;
    return entry.value;
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      this.evictions += cleaned;
    }
  }

  // 用于调试和监控
  get size(): number {
    this.cleanup();
    return this.cache.size;
  }
  
  /**
   * 获取缓存统计信息
   */
  getStats(): {
    name: string;
    size: number;
    maxSize: number;
    hits: number;
    misses: number;
    hitRate: number;
    evictions: number;
  } {
    const total = this.hits + this.misses;
    return {
      name: this.name,
      size: this.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      evictions: this.evictions,
    };
  }
  
  /**
   * 重置统计指标
   */
  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }
}

// 查询降级级别：full -> fallback (no noteAttributes) -> minimal (no customer)
type QueryLevel = "full" | "fallback" | "minimal";

// Track shops that need fallback/minimal queries
// Using TTL cache to prevent memory leaks and allow recovery if API changes
const shopsQueryLevel = new TTLCache<string, QueryLevel>({ 
  maxSize: 1000, 
  ttlMs: 24 * 60 * 60 * 1000, // 24 小时后重试完整查询
  name: 'orders_query_level',
});
const shopsSingleQueryLevel = new TTLCache<string, QueryLevel>({ 
  maxSize: 1000, 
  ttlMs: 24 * 60 * 60 * 1000,
  name: 'single_order_query_level',
});

/**
 * 【优化】导出缓存统计函数，用于监控
 */
export const getQueryLevelCacheStats = () => ({
  ordersCache: shopsQueryLevel.getStats(),
  singleOrderCache: shopsSingleQueryLevel.getStats(),
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

const platform = getPlatform();

/**
 * 验证 Shopify Order GID 格式
 * @param id - 要验证的 ID
 * @returns 是否为有效的 Order GID 格式
 */
const isValidOrderGid = (id: string): boolean => {
  if (!id || typeof id !== "string") return false;
  // Shopify Order GID 格式: gid://shopify/Order/数字
  return /^gid:\/\/shopify\/Order\/\d+$/.test(id);
};

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

/**
 * 【重构】统一的查询降级处理器
 * 检查错误类型并自动降级查询级别
 * @returns 'retry' 需要重试, 'throw' 需要抛出错误, null 无需降级
 */
type DowngradeAction = 'retry' | 'throw' | null;

const handleQueryDowngrade = (
  shopDomain: string | undefined,
  queryLevel: QueryLevel,
  queryType: "orders" | "single",
  error: unknown,
  logContext: Record<string, unknown>,
): DowngradeAction => {
  const errorStr = error instanceof Error ? error.message : String(error);
  
  // 检查是否需要降级到 fallback (noteAttributes 不可用)
  if (queryLevel === "full" && isNoteAttributesError(errorStr)) {
    logger.warn(`[${queryType}] noteAttributes not available, downgrading to fallback`, {
      ...logContext,
      shopDomain,
      platform,
    });
    markShopNeedsFallback(shopDomain, queryType);
    return 'retry';
  }
  
  // 检查是否需要降级到 minimal (customer 字段权限问题)
  if (queryLevel !== "minimal" && isCustomerAccessError(errorStr)) {
    logger.warn(`[${queryType}] customer field access denied (PCD), downgrading to minimal`, {
      ...logContext,
      shopDomain,
      platform,
      errorMsg: errorStr.slice(0, 200),
    });
    markShopNeedsMinimal(shopDomain, queryType);
    return 'retry';
  }
  
  return null;
};

/**
 * 【重构】处理 GraphQL 响应中的错误
 * @returns 'retry' 需要重试, 'throw' 需要抛出错误, null 继续处理
 */
const handleGraphQLErrors = (
  json: { errors?: unknown },
  shopDomain: string | undefined,
  queryLevel: QueryLevel,
  queryType: "orders" | "single",
  logContext: Record<string, unknown>,
): DowngradeAction => {
  if (!json.errors) return null;
  
  const errorMessages = Array.isArray(json.errors) 
    ? json.errors.map((e: { message?: string }) => e.message || JSON.stringify(e)).join("; ")
    : JSON.stringify(json.errors);
  
  const downgradeAction = handleQueryDowngrade(
    shopDomain,
    queryLevel,
    queryType,
    json.errors,
    logContext,
  );
  
  if (downgradeAction === 'retry') {
    return 'retry';
  }
  
  // 无法降级，记录错误
  logger.error(`[${queryType}] GraphQL errors`, {
    ...logContext,
    shopDomain,
    platform,
    queryLevel,
    errorMessages,
  });
  
  return 'throw';
};

// 根据查询级别选择查询
const getOrdersQuery = (level: QueryLevel): string => {
  switch (level) {
    case "minimal": return ORDERS_QUERY_MINIMAL;
    case "fallback": return ORDERS_QUERY_FALLBACK;
    default: return ORDERS_QUERY;
  }
};

/**
 * 获取订单页面数据
 * @param admin - GraphQL 客户端
 * @param query - 查询条件字符串
 * @param after - 分页游标
 * @param context - 上下文信息
 * @param downgradeRetryCount - 降级重试计数器（防止无限递归）
 */
const fetchOrdersPage = async (
  admin: AdminGraphqlClient,
  query: string,
  after: string | undefined,
  context: FetchContext,
  downgradeRetryCount = 0,
): Promise<{
  data?: {
    orders?: {
      pageInfo: { hasNextPage: boolean; endCursor?: string | null };
      edges: { node: ShopifyOrderNode }[];
    };
  };
  errors?: unknown;
}> => {
  // 防止无限递归：检查降级重试次数
  if (downgradeRetryCount >= GRAPHQL_MAX_DOWNGRADE_RETRIES) {
    logger.error("[backfill] max downgrade retries exceeded", {
      platform,
      shopDomain: context.shopDomain,
      downgradeRetryCount,
      maxRetries: GRAPHQL_MAX_DOWNGRADE_RETRIES,
    });
    throw new Error(`Orders query failed: max downgrade retries (${GRAPHQL_MAX_DOWNGRADE_RETRIES}) exceeded`);
  }

  const sdk = createGraphqlSdk(admin, context.shopDomain);
  const shopDomain = context.shopDomain;
  const logContext = { intent: context?.intent, jobType: "backfill" };
  
  // 选择使用的查询级别 - per shop
  const queryLevel = getQueryLevel(shopDomain, "orders");
  const ordersQuery = getOrdersQuery(queryLevel);
  
  logger.info("[backfill] fetching orders page", {
    platform,
    shopDomain,
    queryLevel,
    downgradeRetryCount,
    ...logContext,
  });
  
  let response: Response;
  try {
    response = await sdk.request("orders query", ordersQuery, { first: 50, after, query }, { timeoutMs: GRAPHQL_TIMEOUT_MS });
  } catch (error) {
    // 使用统一的降级处理
    const action = handleQueryDowngrade(shopDomain, queryLevel, "orders", error, logContext);
    if (action === 'retry') {
      return fetchOrdersPage(admin, query, after, context, downgradeRetryCount + 1);
    }
    throw error;
  }
  
  if (!response.ok) {
    const text = await response.text();
    
    // 使用统一的降级处理
    const action = handleQueryDowngrade(shopDomain, queryLevel, "orders", text, logContext);
    if (action === 'retry') {
      return fetchOrdersPage(admin, query, after, context, downgradeRetryCount + 1);
    }
    
    logger.error("[backfill] orders page fetch failed", {
      platform,
      shopDomain,
      queryLevel,
      ...logContext,
    }, { status: response.status, body: text.slice(0, 200) });
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
  
  // 使用统一的错误处理
  const errorAction = handleGraphQLErrors(json, shopDomain, queryLevel, "orders", logContext);
  if (errorAction === 'retry') {
    return fetchOrdersPage(admin, query, after, context, downgradeRetryCount + 1);
  }
  if (errorAction === 'throw') {
    const errorMessages = Array.isArray(json.errors) 
      ? json.errors.map((e: { message?: string }) => e.message || JSON.stringify(e)).join("; ")
      : JSON.stringify(json.errors);
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

  // 【优化】输入验证：确保日期范围有效
  if (!range.start || !range.end) {
    logger.error("[backfill] Invalid date range: missing start or end", {
      platform,
      shopDomain: context?.shopDomain,
      start: range.start?.toISOString(),
      end: range.end?.toISOString(),
    });
    throw new Error("Invalid date range: start and end dates are required");
  }
  
  if (range.start > range.end) {
    logger.warn("[backfill] Invalid date range: start > end, swapping dates", {
      platform,
      shopDomain: context?.shopDomain,
      originalStart: range.start.toISOString(),
      originalEnd: range.end.toISOString(),
    });
    // 自动交换日期，而不是抛出错误（更宽容的处理）
    [range.start, range.end] = [range.end, range.start];
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
    searchQuery: search,
    effectiveStart: effectiveStart.toISOString(),
    effectiveEnd: range.end.toISOString(),
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

/**
 * 根据 ID 获取单个订单
 * @param admin - GraphQL 客户端
 * @param id - Shopify Order GID
 * @param settings - 设置配置
 * @param context - 上下文信息
 * @param downgradeRetryCount - 降级重试计数器（防止无限递归）
 */
export const fetchOrderById = async (
  admin: AdminGraphqlClient,
  id: string,
  settings: SettingsDefaults = defaultSettings,
  context?: FetchContext,
  downgradeRetryCount = 0,
): Promise<OrderRecord | null> => {
  if (isDemoMode()) {
    logger.info("[webhook] demo mode enabled; skipping order fetch", { platform, id, jobType: "webhook" });
    return null;
  }

  // 输入验证：检查 Order GID 格式
  if (!isValidOrderGid(id)) {
    logger.warn("[webhook] invalid order GID format", { 
      platform, 
      id, 
      jobType: "webhook",
      shopDomain: context?.shopDomain,
    });
    return null;
  }

  // 防止无限递归：检查降级重试次数
  if (downgradeRetryCount >= GRAPHQL_MAX_DOWNGRADE_RETRIES) {
    logger.error("[webhook] max downgrade retries exceeded", {
      platform,
      shopDomain: context?.shopDomain,
      id,
      downgradeRetryCount,
      maxRetries: GRAPHQL_MAX_DOWNGRADE_RETRIES,
    });
    return null;
  }

  const shopDomain = context?.shopDomain;
  const sdk = createGraphqlSdk(admin, shopDomain);
  const logContext = { id, jobType: "webhook", downgradeRetryCount };
  
  // 选择使用的查询级别 - per shop
  const queryLevel = getQueryLevel(shopDomain, "single");
  const orderQuery = getSingleOrderQuery(queryLevel);
  
  let response: Response;
  try {
    response = await sdk.request("order query", orderQuery, { id }, { timeoutMs: GRAPHQL_TIMEOUT_MS });
  } catch (error) {
    // 使用统一的降级处理
    const action = handleQueryDowngrade(shopDomain, queryLevel, "single", error, logContext);
    if (action === 'retry') {
      return fetchOrderById(admin, id, settings, context, downgradeRetryCount + 1);
    }
    
    logger.error("[webhook] order fetch failed with exception", { 
      platform, 
      shopDomain, 
      queryLevel,
      ...logContext,
    }, { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
  
  if (!response.ok) {
    const text = await response.text();
    
    // 使用统一的降级处理
    const action = handleQueryDowngrade(shopDomain, queryLevel, "single", text, logContext);
    if (action === 'retry') {
      return fetchOrderById(admin, id, settings, context, downgradeRetryCount + 1);
    }
    
    logger.error("[webhook] order fetch failed", { 
      platform, 
      shopDomain, 
      queryLevel,
      ...logContext,
    }, { status: response.status, body: text.slice(0, 200) });
    return null;
  }

  const json = (await response.json()) as { data?: { order?: ShopifyOrderNode | null }; errors?: unknown };
  
  // 使用统一的错误处理
  const errorAction = handleGraphQLErrors(json, shopDomain, queryLevel, "single", logContext);
  if (errorAction === 'retry') {
    return fetchOrderById(admin, id, settings, context, downgradeRetryCount + 1);
  }
  if (errorAction === 'throw') {
    // 对于单订单查询，返回 null 而不是抛异常（保持原有行为）
    return null;
  }
  
  if (!json.data?.order) return null;

  return mapShopifyOrderToRecord(json.data.order, settings);
};
