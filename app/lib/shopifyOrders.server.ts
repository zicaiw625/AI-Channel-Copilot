import { defaultSettings, mapShopifyOrderToRecord, type DateRange } from "./aiData";
import type { OrderRecord, SettingsDefaults, ShopifyOrderNode } from "./aiData";
import { getPlatform, isDemoMode } from "./runtime.server";

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
          }
        }
        currentSubtotalPriceSet {
          shopMoney {
            amount
          }
        }
        referringSite
        landingPageUrl
        sourceName
        tags
        noteAttributes {
          name
          value
        }
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
        }
      }
      currentSubtotalPriceSet {
        shopMoney {
          amount
        }
      }
      referringSite
      landingPageUrl
      sourceName
      tags
      noteAttributes {
        name
        value
      }
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
  graphql: (query: string, options: { variables?: Record<string, unknown> }) => Promise<Response>;
};

const MAX_BACKFILL_PAGES = 20;
const MAX_BACKFILL_ORDERS = 1000;
const MAX_BACKFILL_DAYS = 90;
const MAX_BACKFILL_DURATION_MS = 5000;

const platform = getPlatform();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const graphqlWithRetry = async (
  admin: AdminGraphqlClient,
  query: string,
  variables: Record<string, unknown>,
  context: { operation: string; shopDomain?: string },
  maxRetries = 2,
) => {
  let attempt = 0;
  let lastResponse: Response | null = null;

  while (attempt <= maxRetries) {
    const response = await admin.graphql(query, { variables });
    if (response.ok) return response;

    lastResponse = response;
    const shouldRetry =
      response.status === 429 || response.status === 500 || response.status === 502 || response.status === 503;
    if (!shouldRetry || attempt === maxRetries) {
      const text = await response.text();
      throw new Error(
        `Shopify ${context.operation} failed: ${response.status} ${text} (attempt ${attempt + 1}/${
          maxRetries + 1
        })`,
      );
    }

    const delay = 200 * 2 ** attempt;
    console.warn("[shopify] retrying graphql", {
      platform,
      shopDomain: context.shopDomain,
      operation: context.operation,
      attempt: attempt + 1,
      status: response.status,
      delay,
    });
    await sleep(delay);
    attempt += 1;
  }

  throw new Error(
    `Shopify ${context.operation} failed after retries: ${lastResponse?.status ?? "unknown status"}`,
  );
};

const fetchOrdersPage = async (
  admin: AdminGraphqlClient,
  query: string,
  after: string | undefined,
  context: FetchContext,
) => {
  const response = await graphqlWithRetry(
    admin,
    ORDERS_QUERY,
    { first: 50, after, query },
    { operation: "orders query", shopDomain: context.shopDomain },
  );

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
    console.info("[backfill] demo mode enabled; skipping Shopify fetch", {
      platform,
      shopDomain: context?.shopDomain,
      intent: context?.intent,
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

  console.info("[backfill] fetching orders", {
    platform,
    shopDomain: context?.shopDomain,
    intent: context?.intent,
    range: context?.rangeLabel || `${effectiveStart.toISOString()} to ${range.end.toISOString()}`,
  });

  do {
    if (Date.now() - startedAt > maxDuration) {
      hitDurationLimit = true;
      break;
    }

    const json = await fetchOrdersPage(admin, search, after, context || {});
    const page = json.data?.orders;
    if (!page) break;

    page.edges.forEach(({ node }) => {
      records.push(mapShopifyOrderToRecord(node, settings));
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

  console.info("[backfill] fetched orders", {
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
    console.info("[webhook] demo mode enabled; skipping order fetch", { platform, id });
    return null;
  }

  const response = await graphqlWithRetry(
    admin,
    ORDER_QUERY,
    { id },
    { operation: "order query", shopDomain: context?.shopDomain },
  );

  const json = (await response.json()) as { data?: { order?: ShopifyOrderNode | null } };
  if (!json.data?.order) return null;

  return mapShopifyOrderToRecord(json.data.order, settings);
};
