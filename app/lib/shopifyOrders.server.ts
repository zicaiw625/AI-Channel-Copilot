import { defaultSettings, mapShopifyOrderToRecord, type DateRange, type OrderRecord, type SettingsDefaults, type ShopifyOrderNode } from "./aiData";
import { getPlatform, isDemoMode } from "./runtime.server";
import { createGraphqlSdk } from "./graphqlSdk.server";
import {
  MAX_BACKFILL_DAYS,
  MAX_BACKFILL_DURATION_MS,
  MAX_BACKFILL_ORDERS,
} from "./constants";
import { logger } from "./logger.server";

const ORDERS_QUERY = `#graphql
  query OrdersForAiDashboard($first: Int!, $after: String, $query: String!) {
    orders(first: $first, after: $after, query: $query, reverse: true, sortKey: CREATED_AT) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
      node {
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
        }
      }
    }
  }
`;

const ORDER_QUERY = `#graphql
  query OrderForAiDashboard($id: ID!) {
    order(id: $id) {
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
    }
  }
`;

type AdminGraphqlClient = {
  graphql: (
    query: string,
    options: { variables?: Record<string, unknown>; signal?: AbortSignal },
  ) => Promise<Response>;
};

const MAX_BACKFILL_PAGES = 20;
const DEFAULT_GRAPHQL_TIMEOUT_MS = 4500;

const platform = getPlatform();

// no local sleep needed after SDK adoption

const fetchOrdersPage = async (
  admin: AdminGraphqlClient,
  query: string,
  after: string | undefined,
  context: FetchContext,
) => {
  const sdk = createGraphqlSdk(admin, context.shopDomain);
  const response = await sdk.request("orders query", ORDERS_QUERY, { first: 50, after, query }, { timeoutMs: DEFAULT_GRAPHQL_TIMEOUT_MS });

  return (await response.json()) as {
    data?: {
      orders?: {
        pageInfo: { hasNextPage: boolean; endCursor?: string | null };
        edges: { node: ShopifyOrderNode }[];
      };
    };
    errors?: unknown;
  };
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

  const sdk = createGraphqlSdk(admin, context?.shopDomain);
  const response = await sdk.request("order query", ORDER_QUERY, { id }, { timeoutMs: DEFAULT_GRAPHQL_TIMEOUT_MS });

  const json = (await response.json()) as { data?: { order?: ShopifyOrderNode | null } };
  if (!json.data?.order) return null;

  return mapShopifyOrderToRecord(json.data.order, settings);
};
