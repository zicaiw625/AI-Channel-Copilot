import { recordGraphqlCall } from "./observability.server";
import { logger } from "./logger.server";
import { getPlatform } from "./runtime.server";

export type AdminGraphqlClient = {
  graphql: (
    query: string,
    options: { variables?: Record<string, unknown>; signal?: AbortSignal }
  ) => Promise<Response>;
};

type RequestOptions = {
  maxRetries?: number;
  timeoutMs?: number;
};

const platform = getPlatform();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const graphqlRequest = async (
  admin: AdminGraphqlClient,
  operation: string,
  query: string,
  variables: Record<string, unknown>,
  context?: { shopDomain?: string },
  options?: RequestOptions,
) => {
  const maxRetries = options?.maxRetries ?? 2;
  const timeoutMs = options?.timeoutMs ?? 4500;
  let attempt = 0;
  let lastResponse: Response | null = null;
  const startedAt = Date.now();

  while (attempt <= maxRetries) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await admin.graphql(query, { variables, signal: controller.signal });
      clearTimeout(timeout);

      if (response.ok) {
        recordGraphqlCall({
          operation,
          shopDomain: context?.shopDomain,
          durationMs: Date.now() - startedAt,
          retries: attempt,
          status: response.status,
          ok: true,
        });
        return response;
      }

      lastResponse = response;
      const shouldRetry =
        response.status === 429 || response.status === 500 || response.status === 502 || response.status === 503;
      if (!shouldRetry || attempt === maxRetries) {
        if (response.status === 302) {
          recordGraphqlCall({
            operation,
            shopDomain: context?.shopDomain,
            durationMs: Date.now() - startedAt,
            retries: attempt,
            status: response.status,
            ok: false,
            error: "302 Response",
          });
          logger.warn("[shopify] graphql auth redirect", {
            platform,
            shopDomain: context?.shopDomain,
            operation,
            status: response.status,
            message: "Response",
            jobType: "shopify-graphql",
          });
          throw response;
        }
        const text = await response.text();
        recordGraphqlCall({
          operation,
          shopDomain: context?.shopDomain,
          durationMs: Date.now() - startedAt,
          retries: attempt,
          status: response.status,
          ok: false,
          error: text,
        });
        logger.error("[shopify] graphql request failed", {
          platform,
          shopDomain: context?.shopDomain,
          operation,
          status: response.status,
          message: text,
          jobType: "shopify-graphql",
        });
        throw new Error(
          `Shopify ${operation} failed: ${response.status} ${text} (attempt ${attempt + 1}/${maxRetries + 1})`,
        );
      }

      const delay = 200 * 2 ** attempt;
      logger.warn("[shopify] retrying graphql", {
        platform,
        shopDomain: context?.shopDomain,
        operation,
        attempt: attempt + 1,
        status: response.status,
        delay,
        jobType: "shopify-graphql",
      });
      await sleep(delay);
  } catch (error) {
    clearTimeout(timeout);
    const isAbortError = (error as Error).name === "AbortError";
    const message = (() => {
      if (isAbortError) return `graphql request timed out after ${timeoutMs}ms`;
      if (error instanceof Response) return `${error.status} ${error.statusText || "Response"}`;
      const m = (error as Error).message;
      return m || "unknown";
    })();
    const shouldRetry = isAbortError && attempt < maxRetries;

    recordGraphqlCall({
      operation,
      shopDomain: context?.shopDomain,
      durationMs: Date.now() - startedAt,
      retries: attempt,
      status: lastResponse?.status ?? (error instanceof Response ? error.status : undefined),
      ok: false,
      error: message,
    });

    if (!shouldRetry) {
      logger.error("[shopify] graphql request failed", {
        platform,
        shopDomain: context?.shopDomain,
        operation,
        status: lastResponse?.status ?? (error instanceof Response ? error.status : undefined),
        message,
        jobType: "shopify-graphql",
      });
      throw new Error(`Shopify ${operation} failed: ${message} (attempt ${attempt + 1}/${maxRetries + 1})`);
    }

      const delay = 200 * 2 ** attempt;
      logger.warn("[shopify] retrying graphql", {
        platform,
        shopDomain: context?.shopDomain,
        operation,
        attempt: attempt + 1,
        status: lastResponse?.status ?? (isAbortError ? "timeout" : undefined),
        delay,
        jobType: "shopify-graphql",
      });
      await sleep(delay);
    }
    attempt += 1;
  }

  recordGraphqlCall({
    operation,
    shopDomain: context?.shopDomain,
    durationMs: Date.now() - startedAt,
    retries: attempt,
    status: lastResponse?.status,
    ok: false,
    error: "exhausted retries",
  });
  throw new Error(`Shopify ${operation} failed after retries: ${lastResponse?.status ?? "unknown status"}`);
};

export const createGraphqlSdk = (admin: AdminGraphqlClient, shopDomain?: string) => {
  return {
    request: (
      operation: string,
      query: string,
      variables: Record<string, unknown> = {},
      options?: RequestOptions,
    ) => graphqlRequest(admin, operation, query, variables, { shopDomain }, options),
  };
};
