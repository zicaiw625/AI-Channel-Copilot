export type GraphqlCallResult = {
  operation: string;
  shopDomain?: string;
  durationMs: number;
  retries: number;
  status?: number;
  ok: boolean;
  error?: string;
};

const graphqlCounters = new Map<string, { success: number; failure: number; retries: number; lastError?: string }>();

export const recordGraphqlCall = (result: GraphqlCallResult) => {
  const key = `${result.operation}`;
  const entry = graphqlCounters.get(key) || { success: 0, failure: 0, retries: 0 };

  if (result.ok) {
    entry.success += 1;
    entry.retries += result.retries;
  } else {
    entry.failure += 1;
    entry.retries += result.retries;
    entry.lastError = `${result.status ?? "n/a"}: ${result.error || "unknown"}`;
  }

  graphqlCounters.set(key, entry);

  if (!result.ok || entry.failure % 5 === 0) {
    console.info("[shopify][graphql] metrics", {
      operation: result.operation,
      shopDomain: result.shopDomain,
      durationMs: result.durationMs,
      retries: result.retries,
      status: result.status,
      success: entry.success,
      failure: entry.failure,
      lastError: entry.lastError,
    });
  }
};
