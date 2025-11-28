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

export const fetchOrdersForRange = async (
  admin: AdminGraphqlClient,
  range: DateRange,
  settings: SettingsDefaults = defaultSettings,
): Promise<{ orders: OrderRecord[]; start: Date; end: Date }> => {
  const search = `created_at:>=${range.start.toISOString()} created_at:<=${range.end.toISOString()}`;
  const records: OrderRecord[] = [];

  let after: string | undefined;
  let guard = 0;

  do {
    const json = await fetchOrdersPage(admin, search, after);
    const page = json.data?.orders;
    if (!page) break;

    page.edges.forEach(({ node }) => {
      records.push(mapShopifyOrderToRecord(node, settings));
    });

    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor || undefined : undefined;
    guard += 1;
    if (guard > 20) {
      // Avoid runaway pagination in extreme cases.
      break;
    }
  } while (after);

  return { orders: records, start: range.start, end: range.end };
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
