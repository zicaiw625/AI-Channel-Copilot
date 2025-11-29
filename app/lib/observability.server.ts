export type GraphqlCallResult = {
  operation: string;
  shopDomain?: string;
  durationMs: number;
  retries: number;
  status?: number;
  ok: boolean;
  error?: string;
};

type GraphqlCounter = {
  success: number;
  failure: number;
  retries: number;
  lastError?: string;
  lastAlertAt?: number;
};

const graphqlCounters = new Map<string, GraphqlCounter>();
const ALERT_SAMPLE_MIN = 10;
const ALERT_FAILURE_RATE = 0.2;
const ALERT_COOLDOWN_MS = 60_000;

let metricsSink: ((operation: string, metrics: GraphqlCounter) => void) | null = null;

export const onGraphqlMetrics = (sink: ((operation: string, metrics: GraphqlCounter) => void) | null) => {
  metricsSink = sink;
};

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

  const attempts = entry.success + entry.failure;
  const failureRate = attempts ? entry.failure / attempts : 0;
  const shouldAlert =
    attempts >= ALERT_SAMPLE_MIN &&
    failureRate >= ALERT_FAILURE_RATE &&
    (!entry.lastAlertAt || Date.now() - entry.lastAlertAt > ALERT_COOLDOWN_MS);

  if (shouldAlert) {
    entry.lastAlertAt = Date.now();
    console.warn("[shopify][graphql] elevated failure rate", {
      operation: result.operation,
      failureRate: Number(failureRate.toFixed(2)),
      attempts,
      success: entry.success,
      failure: entry.failure,
    });
  }

  if (metricsSink) {
    metricsSink(result.operation, { ...entry });
  }
};

export const getGraphqlMetricsSnapshot = () => Object.fromEntries(graphqlCounters.entries());

export const resetGraphqlMetrics = () => graphqlCounters.clear();
