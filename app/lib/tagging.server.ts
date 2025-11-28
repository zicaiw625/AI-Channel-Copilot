import type { OrderRecord, SettingsDefaults } from "./aiData";

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

export const applyAiTags = async (
  admin: AdminGraphqlClient,
  orders: OrderRecord[],
  settings: SettingsDefaults,
) => {
  const orderPrefix = settings.tagging.orderTagPrefix || "AI-Source";
  const customerTag = settings.tagging.customerTag || "AI-Customer";
  const dryRun = settings.tagging.dryRun;

  for (const order of orders) {
    if (!order.aiSource) continue;

    if (dryRun) {
      // Skip actual writes but keep loop for potential logging/metrics.
      continue;
    }

    if (settings.tagging.writeOrderTags) {
      const orderTag = `${orderPrefix}-${order.aiSource}`;
      await addTags(admin, order.id, [orderTag]);
    }

    if (settings.tagging.writeCustomerTags && order.customerId) {
      await addTags(admin, order.customerId, [customerTag]);
    }
  }
};
