const fromEnv = (key: string, fallback: number) => {
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

export const DEFAULT_RANGE_KEY = "30d" as const;
export const DEFAULT_RETENTION_MONTHS = fromEnv("DEFAULT_RETENTION_MONTHS", 6);
export const MAX_DASHBOARD_ORDERS = fromEnv("MAX_DASHBOARD_ORDERS", 5000);
export const MAX_BACKFILL_ORDERS = fromEnv("MAX_BACKFILL_ORDERS", 1000);
export const MAX_BACKFILL_DAYS = fromEnv("MAX_BACKFILL_DAYS", 90);
export const MAX_BACKFILL_DURATION_MS = fromEnv("MAX_BACKFILL_DURATION_MS", 15000);
export const BACKFILL_TAGGING_BATCH_SIZE = fromEnv("BACKFILL_TAGGING_BATCH_SIZE", 25);
export const BACKFILL_COOLDOWN_MINUTES = fromEnv("BACKFILL_COOLDOWN_MINUTES", 30);
export const MAX_DETECTION_LENGTH = 200;
export const LANGUAGE_STORAGE_KEY = "aicc_language";
export const LANGUAGE_EVENT = "aicc_language_change";

// 数据持久化相关常量
export const PERSISTENCE_BATCH_SIZE = fromEnv("PERSISTENCE_BATCH_SIZE", 100);
export const PERSISTENCE_TRANSACTION_TIMEOUT_MS = fromEnv("PERSISTENCE_TRANSACTION_TIMEOUT_MS", 30000);

// 数据清理相关常量
export const RETENTION_DELETE_BATCH_SIZE = fromEnv("RETENTION_DELETE_BATCH_SIZE", 1000);
export const RETENTION_DELETE_BATCH_DELAY_MS = fromEnv("RETENTION_DELETE_BATCH_DELAY_MS", 100);
