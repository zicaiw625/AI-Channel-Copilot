import { defaultSettings, mapShopifyOrderToRecord, type DateRange } from "./aiData";
import type { OrderRecord, SettingsDefaults, ShopifyOrderNode } from "./aiData";

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

const fetchOrdersPage = async (
  admin: AdminGraphqlClient,
  query: string,
  after?: string,
) => {
  const response = await admin.graphql(ORDERS_QUERY, {
    variables: { first: 50, after, query },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Shopify orders query failed: ${response.status} ${text}`);
  }

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
): Promise<{
  orders: OrderRecord[];
  start: Date;
  end: Date;
  clamped: boolean;
  pageCount: number;
  hitPageLimit: boolean;
  hitOrderLimit: boolean;
}> => {
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

  do {
    const json = await fetchOrdersPage(admin, search, after);
    const page = json.data?.orders;
    if (!page) break;

    page.edges.forEach(({ node }) => {
      records.push(mapShopifyOrderToRecord(node, settings));
    });

    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor || undefined : undefined;
    guard += 1;
    if (guard >= MAX_BACKFILL_PAGES || records.length >= MAX_BACKFILL_ORDERS) {
      // Avoid runaway pagination in extreme cases.
      hitPageLimit = guard >= MAX_BACKFILL_PAGES;
      hitOrderLimit = records.length >= MAX_BACKFILL_ORDERS;
      break;
    }
  } while (after);

  console.info("[backfill] fetched orders", {
    shopDomain: context?.shopDomain,
    intent: context?.intent,
    range: context?.rangeLabel || `${effectiveStart.toISOString()} to ${range.end.toISOString()}`,
    orders: records.length,
    pages: guard,
    clamped,
    hitPageLimit,
    hitOrderLimit,
  });

  return {
    orders: records,
    start: effectiveStart,
    end: range.end,
    clamped,
    pageCount: guard,
    hitPageLimit,
    hitOrderLimit,
  };
};

export const fetchOrderById = async (
  admin: AdminGraphqlClient,
  id: string,
  settings: SettingsDefaults = defaultSettings,
): Promise<OrderRecord | null> => {
  const response = await admin.graphql(ORDER_QUERY, { variables: { id } });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Shopify order query failed: ${response.status} ${text}`);
  }

  const json = (await response.json()) as { data?: { order?: ShopifyOrderNode | null } };
  if (!json.data?.order) return null;

  return mapShopifyOrderToRecord(json.data.order, settings);
};
