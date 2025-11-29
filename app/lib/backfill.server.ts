import type { SettingsDefaults } from "./aiData";
import { fetchOrdersForRange } from "./shopifyOrders.server";
import type { DateRange } from "./aiData";
import { markActivity } from "./settings.server";
import { persistOrders } from "./persistence.server";

const inflightBackfills = new Map<string, { startedAt: number; range: string }>();

export const isBackfillRunning = (shopDomain: string) => inflightBackfills.has(shopDomain);

export const describeBackfill = (shopDomain: string) => inflightBackfills.get(shopDomain);

export const startBackfill = async (
  admin: { graphql: (query: string, options: { variables?: Record<string, unknown> }) => Promise<Response> },
  shopDomain: string,
  range: DateRange,
  settings: SettingsDefaults,
  options?: { maxOrders?: number; maxDurationMs?: number },
) => {
  if (!shopDomain) return { queued: false, reason: "missing shop domain" } as const;
  if (inflightBackfills.has(shopDomain)) {
    return { queued: false, reason: "in-flight" } as const;
  }

  inflightBackfills.set(shopDomain, { startedAt: Date.now(), range: range.label });

  void (async () => {
    try {
      const fetched = await fetchOrdersForRange(
        admin,
        range,
        settings,
        { shopDomain, intent: "manual-backfill", rangeLabel: range.label },
        options,
      );

      if (fetched.orders.length > 0) {
        await persistOrders(shopDomain, fetched.orders);
        await markActivity(shopDomain, { lastBackfillAt: new Date() });
      }
    } catch (error) {
      console.error("[backfill] background job failed", {
        shopDomain,
        message: (error as Error).message,
      });
    } finally {
      inflightBackfills.delete(shopDomain);
    }
  })();

  return { queued: true as const };
};
