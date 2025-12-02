import type { OrderRecord, SettingsDefaults } from "./aiData";
import { getPlatform, isDemoMode } from "./runtime.server";
import { logger } from "./logger.server";
import { BACKFILL_TAGGING_BATCH_SIZE } from "./constants";
import { createGraphqlSdk, type AdminGraphqlClient } from "./graphqlSdk.server";


const TAGS_ADD = `#graphql
  mutation AddTags($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      userErrors {
        field
        message
      }
    }
  }
`;

const addTags = async (admin: AdminGraphqlClient, id: string, tags: string[]) => {
  if (!tags.length) return;
  const sdk = createGraphqlSdk(admin);
  const response = await sdk.request("tagsAdd", TAGS_ADD, { id, tags });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to add tags to ${id}: ${response.status} ${text}`);
  }

  const json = await response.json();
  const errors = json?.data?.tagsAdd?.userErrors || [];
  if (errors.length) {
    throw new Error(`Failed to add tags to ${id}: ${JSON.stringify(errors)}`);
  }
};

const platform = getPlatform();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const applyAiTags = async (
  admin: AdminGraphqlClient,
  orders: OrderRecord[],
  settings: SettingsDefaults,
  context?: { shopDomain?: string; intent?: string },
) => {
  if (isDemoMode()) {
    logger.info(
      "[tagging] demo mode active; skipping tag writes",
      { platform, shopDomain: context?.shopDomain, intent: context?.intent },
    );
    return;
  }

  const orderPrefix = settings.tagging.orderTagPrefix || "AI-Source";
  const customerTag = settings.tagging.customerTag || "AI-Customer";
  const dryRun = settings.tagging.dryRun;
  const orderTagTargets: { id: string; tags: string[] }[] = [];
  const customerTagTargets: { id: string; tags: string[] }[] = [];
  const seenCustomers = new Set<string>();

  const runInBatches = async (targets: { id: string; tags: string[] }[]) => {
    const batchSize = BACKFILL_TAGGING_BATCH_SIZE;
    const failures: { id: string; error: string }[] = [];
    let successes = 0;
    for (let i = 0; i < targets.length; i += batchSize) {
      const slice = targets.slice(i, i + batchSize);
      for (const target of slice) {
        let attempt = 0;
        let done = false;
        while (attempt <= 2 && !done) {
          try {
            await addTags(admin, target.id, target.tags);
            successes += 1;
            done = true;
          } catch (error) {
            const delay = 200 * 2 ** attempt;
            if (attempt === 2) {
              failures.push({ id: target.id, error: (error as Error).message });
            } else {
              await sleep(delay);
            }
            attempt += 1;
          }
        }
      }
    }
    return { successes, failures };
  };

  for (const order of orders) {
    if (!order.aiSource) continue;

    if (dryRun) {
      // Skip actual writes but keep loop for potential logging/metrics.
      continue;
    }

    if (settings.tagging.writeOrderTags) {
      const orderTag = `${orderPrefix}-${order.aiSource}`;
      if (!order.tags?.includes(orderTag)) {
        orderTagTargets.push({ id: order.id, tags: [orderTag] });
      }
    }

    if (settings.tagging.writeCustomerTags && order.customerId) {
      if (!seenCustomers.has(order.customerId)) {
        customerTagTargets.push({ id: order.customerId, tags: [customerTag] });
        seenCustomers.add(order.customerId);
      }
    }
  }

  let orderResult: { successes: number; failures: { id: string; error: string }[] } | null = null;
  let customerResult: { successes: number; failures: { id: string; error: string }[] } | null = null;
  if (!dryRun) {
    orderResult = await runInBatches(orderTagTargets);
    customerResult = await runInBatches(customerTagTargets);
  }

  logger.info(
    "[tagging] completed tagging batch",
    { platform, shopDomain: context?.shopDomain, intent: context?.intent },
    {
      dryRun,
      ordersAttempted: orders.length,
      orderTagTargets: orderTagTargets.length,
      customerTagTargets: customerTagTargets.length,
      orderSuccesses: orderResult?.successes || 0,
      orderFailures: orderResult?.failures.length || 0,
      customerSuccesses: customerResult?.successes || 0,
      customerFailures: customerResult?.failures.length || 0,
    },
  );
  }
