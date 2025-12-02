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
