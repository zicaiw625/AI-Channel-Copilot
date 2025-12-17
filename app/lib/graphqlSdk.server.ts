import { recordGraphqlCall } from "./observability.server";
import { logger } from "./logger.server";
import { getPlatform } from "./runtime.server";

export type AdminGraphqlClient = {
  graphql: (
    query: string,
    options: { variables?: Record<string, unknown>; signal?: AbortSignal }
  ) => Promise<Response>;
};

/**
 * 类型守卫：检查对象是否具有 graphql 方法
 * 用于安全地检查 unauthenticated.admin 的返回值
 */
export const isAdminGraphqlClient = (obj: unknown): obj is AdminGraphqlClient => {
  return (
    obj !== null &&
    typeof obj === "object" &&
    "graphql" in obj &&
    typeof (obj as Record<string, unknown>).graphql === "function"
  );
};

/**
 * 类型守卫：检查对象是否具有 admin 属性且 admin 具有 graphql 方法
 */
const hasAdminProperty = (obj: unknown): obj is { admin: AdminGraphqlClient } => {
  return (
    obj !== null &&
    typeof obj === "object" &&
    "admin" in obj &&
    isAdminGraphqlClient((obj as Record<string, unknown>).admin)
  );
};

/**
 * 从 unauthenticated.admin 的返回值中提取 AdminGraphqlClient
 * 统一处理 Shopify SDK 不同版本可能返回的不同结构
 * 
 * @param unauthResult - unauthenticated.admin() 的返回值
 * @returns AdminGraphqlClient 或 null
 */
export const extractAdminClient = (unauthResult: unknown): AdminGraphqlClient | null => {
  // 直接返回的是 AdminGraphqlClient
  if (isAdminGraphqlClient(unauthResult)) {
    return unauthResult;
  }
  // 返回的是包含 admin 属性的对象
  if (hasAdminProperty(unauthResult)) {
    return unauthResult.admin;
  }
  return null;
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
    if (error instanceof Response && error.status === 302) {
      throw error;
    }
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
