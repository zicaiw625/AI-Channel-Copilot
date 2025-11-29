import { logger } from "./logger.server";

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
const METRICS_ENDPOINT = process.env.METRICS_WEBHOOK_URL;
const METRICS_TOKEN = process.env.METRICS_WEBHOOK_TOKEN;
const METRICS_TIMEOUT_MS = 1500;

let metricsSink: ((operation: string, metrics: GraphqlCounter) => void) | null = null;
let metricsAlertedAt = 0;

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
    logger.info(
      "[shopify][graphql] metrics",
      { operation: result.operation, shopDomain: result.shopDomain },
      {
        durationMs: result.durationMs,
        retries: result.retries,
        status: result.status,
        success: entry.success,
        failure: entry.failure,
        lastError: entry.lastError,
      },
    );
  }

  const attempts = entry.success + entry.failure;
  const failureRate = attempts ? entry.failure / attempts : 0;
  const shouldAlert =
    attempts >= ALERT_SAMPLE_MIN &&
    failureRate >= ALERT_FAILURE_RATE &&
    (!entry.lastAlertAt || Date.now() - entry.lastAlertAt > ALERT_COOLDOWN_MS);

  if (shouldAlert) {
    entry.lastAlertAt = Date.now();
    logger.warn(
      "[shopify][graphql] elevated failure rate",
      { operation: result.operation, shopDomain: result.shopDomain },
      {
        failureRate: Number(failureRate.toFixed(2)),
        attempts,
        success: entry.success,
        failure: entry.failure,
      },
    );
  }

  if (metricsSink) {
    metricsSink(result.operation, { ...entry });
  }

  void postGraphqlMetric(result, entry);
};

const postGraphqlMetric = async (result: GraphqlCallResult, snapshot: GraphqlCounter) => {
  if (!METRICS_ENDPOINT) return;

  const attempts = snapshot.success + snapshot.failure;
  const failureRate = attempts ? snapshot.failure / attempts : 0;
  const payload = {
    source: "shopify_graphql",
    operation: result.operation,
    shopDomain: result.shopDomain,
    durationMs: result.durationMs,
    retries: result.retries,
    status: result.status,
    ok: result.ok,
    error: result.error,
    totals: {
      success: snapshot.success,
      failure: snapshot.failure,
      retries: snapshot.retries,
      failureRate,
    },
    timestamp: new Date().toISOString(),
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), METRICS_TIMEOUT_MS);

  try {
    await fetch(METRICS_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(METRICS_TOKEN ? { authorization: `Bearer ${METRICS_TOKEN}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    const now = Date.now();
    if (now - metricsAlertedAt > ALERT_COOLDOWN_MS) {
      metricsAlertedAt = now;
      logger.warn(
        "[observability] failed to forward graphql metric",
        { operation: result.operation, shopDomain: result.shopDomain },
        { message: (error as Error).message },
      );
    }
  } finally {
    clearTimeout(timeout);
  }
};

export const getGraphqlMetricsSnapshot = () => Object.fromEntries(graphqlCounters.entries());

export const resetGraphqlMetrics = () => graphqlCounters.clear();
