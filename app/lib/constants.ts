const fromEnv = (key: string, fallback: number) => {
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

export const DEFAULT_RANGE_KEY = "30d" as const;
export const DEFAULT_RETENTION_MONTHS = fromEnv("DEFAULT_RETENTION_MONTHS", 6);
export const MAX_DASHBOARD_ORDERS = fromEnv("MAX_DASHBOARD_ORDERS", 5000);
export const MAX_BACKFILL_ORDERS = fromEnv("MAX_BACKFILL_ORDERS", 1000);
// 【修复】Shopify 默认只允许访问最近 60 天订单
// 要访问更早的订单需要申请 read_all_orders scope
// 参考: https://shopify.dev/docs/api/usage/access-scopes#orders-permissions
export const MAX_BACKFILL_DAYS = fromEnv("MAX_BACKFILL_DAYS", 60);
export const MAX_BACKFILL_DURATION_MS = fromEnv("MAX_BACKFILL_DURATION_MS", 15000);
export const BACKFILL_TAGGING_BATCH_SIZE = fromEnv("BACKFILL_TAGGING_BATCH_SIZE", 25);
export const BACKFILL_COOLDOWN_MINUTES = fromEnv("BACKFILL_COOLDOWN_MINUTES", 30);
export const BACKFILL_TIMEOUT_MINUTES = fromEnv("BACKFILL_TIMEOUT_MINUTES", 10); // 超时取消阈值
export const MAX_DETECTION_LENGTH = 200;
export const LANGUAGE_STORAGE_KEY = "aicc_language";
export const LANGUAGE_EVENT = "aicc_language_change";

// 数据持久化相关常量
export const PERSISTENCE_BATCH_SIZE = fromEnv("PERSISTENCE_BATCH_SIZE", 100);
export const PERSISTENCE_TRANSACTION_TIMEOUT_MS = fromEnv("PERSISTENCE_TRANSACTION_TIMEOUT_MS", 30000);

// GraphQL 查询相关常量
export const GRAPHQL_TIMEOUT_MS = fromEnv("GRAPHQL_TIMEOUT_MS", 4500);
export const GRAPHQL_MAX_DOWNGRADE_RETRIES = fromEnv("GRAPHQL_MAX_DOWNGRADE_RETRIES", 3);

// Webhook 处理相关常量
export const WEBHOOK_TAGGING_THRESHOLD_MS = fromEnv("WEBHOOK_TAGGING_THRESHOLD_MS", 4500);

// 数据清理相关常量
export const RETENTION_DELETE_BATCH_SIZE = fromEnv("RETENTION_DELETE_BATCH_SIZE", 1000);
export const RETENTION_DELETE_BATCH_DELAY_MS = fromEnv("RETENTION_DELETE_BATCH_DELAY_MS", 100);

// llms.txt 缓存相关常量
export const LLMS_CACHE_TTL_MS = fromEnv("LLMS_CACHE_TTL_MS", 60 * 60 * 1000); // 默认 1 小时
export const LLMS_CACHE_UPDATE_COOLDOWN_MS = fromEnv("LLMS_CACHE_UPDATE_COOLDOWN_MS", 5 * 60 * 1000); // 默认 5 分钟

// AI 优化报告相关常量
export const MAX_ORDER_PRODUCTS = fromEnv("MAX_ORDER_PRODUCTS", 10000); // 用于优化报告查询的最大订单产品数
