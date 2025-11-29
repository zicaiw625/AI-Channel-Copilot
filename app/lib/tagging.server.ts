import type { OrderRecord, SettingsDefaults } from "./aiData";
import { getPlatform, isDemoMode } from "./runtime.server";

type AdminGraphqlClient = {
  graphql: (query: string, options: { variables?: Record<string, unknown> }) => Promise<Response>;
};

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
  const response = await admin.graphql(TAGS_ADD, { variables: { id, tags } });
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

export const applyAiTags = async (
  admin: AdminGraphqlClient,
  orders: OrderRecord[],
  settings: SettingsDefaults,
  context?: { shopDomain?: string; intent?: string },
) => {
  if (isDemoMode()) {
    console.info("[tagging] demo mode active; skipping tag writes", {
      platform,
      shopDomain: context?.shopDomain,
      intent: context?.intent,
    });
    return;
  }

  const orderPrefix = settings.tagging.orderTagPrefix || "AI-Source";
  const customerTag = settings.tagging.customerTag || "AI-Customer";
  const dryRun = settings.tagging.dryRun;
  const orderTagTargets: { id: string; tags: string[] }[] = [];
  const customerTagTargets: { id: string; tags: string[] }[] = [];
  const seenCustomers = new Set<string>();

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
  };

  if (!dryRun) {
    await runInBatches(orderTagTargets);
    await runInBatches(customerTagTargets);
  }

  const runInBatches = async (targets: { id: string; tags: string[] }[]) => {
    const batchSize = 5;
    for (let i = 0; i < targets.length; i += batchSize) {
      const slice = targets.slice(i, i + batchSize);
      await Promise.all(slice.map((target) => addTags(admin, target.id, target.tags)));
    }
  };

  if (!dryRun) {
    await runInBatches(orderTagTargets);
    await runInBatches(customerTagTargets);
  }

  console.info("[tagging] completed tagging batch", {
    platform,
    shopDomain: context?.shopDomain,
    intent: context?.intent,
    dryRun,
    ordersAttempted: orders.length,
    orderTagTargets: orderTagTargets.length,
    customerTagTargets: customerTagTargets.length,
  });
};
