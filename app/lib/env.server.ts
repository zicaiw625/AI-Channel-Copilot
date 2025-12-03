const TRUE_VALUES = new Set(["true", "1", "yes", "on"]);
const FALSE_VALUES = new Set(["false", "0", "no", "off"]);

export const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === null || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

export const readBooleanEnv = (name: string, defaultValue = false): boolean => {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return defaultValue;

  const normalized = raw.toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;

  throw new Error(`Invalid boolean value for ${name}: ${raw}`);
};

export const readIntegerEnv = (name: string, defaultValue?: number, minimum?: number): number | undefined => {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return defaultValue;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${name} must be an integer value`);
  }
  if (minimum !== undefined && parsed < minimum) {
    throw new Error(`${name} must be greater than or equal to ${minimum}`);
  }

  return parsed;
};

type AppFlags = {
  demoMode: boolean;
  enableBilling: boolean;
  enableLoginForm: boolean;
  enableBackfillSweep: boolean;
  enableRetentionSweep: boolean;
  billingForceTest: boolean;
};

let cachedFlags: AppFlags | null = null;

export const readAppFlags = (): AppFlags => {
  if (cachedFlags) return cachedFlags;

  cachedFlags = {
    demoMode: readBooleanEnv("DEMO_MODE", false),
    enableBilling: readBooleanEnv("ENABLE_BILLING", false),
    enableLoginForm: readBooleanEnv("ENABLE_LOGIN_FORM", false),
    enableBackfillSweep: readBooleanEnv("ENABLE_BACKFILL_SWEEP", true),
    enableRetentionSweep: readBooleanEnv("ENABLE_RETENTION_SWEEP", true),
    billingForceTest: readBooleanEnv("BILLING_FORCE_TEST", false),
  };

  return cachedFlags;
};

export const validateAppUrl = (urlStr: string) => {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error("Invalid SHOPIFY_APP_URL");
  }
  if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
    throw new Error("SHOPIFY_APP_URL must use https in production");
  }
  return parsed.toString();
};

export const normalizeScopes = (value: string) => {
  const scopes = value
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);

  const uniqueScopes = Array.from(new Set(scopes));

  if (!uniqueScopes.length) {
    throw new Error("SCOPES must not be empty");
  }

  return uniqueScopes.sort();
};

export const readCriticalEnv = () => {
  const SHOPIFY_API_KEY = requireEnv("SHOPIFY_API_KEY");
  const SHOPIFY_API_SECRET = requireEnv("SHOPIFY_API_SECRET");
  const SHOPIFY_APP_URL = validateAppUrl(requireEnv("SHOPIFY_APP_URL"));
  const SCOPES = normalizeScopes(requireEnv("SCOPES"));

  return { SHOPIFY_API_KEY, SHOPIFY_API_SECRET, SHOPIFY_APP_URL, SCOPES } as const;
};

export const isProduction = () => process.env.NODE_ENV === "production";
export const isNonProduction = () => process.env.NODE_ENV !== "production";

type BillingConfig = {
  amount: number;
  currencyCode: string;
  trialDays: number;
  interval: "ANNUAL" | "EVERY_30_DAYS";
  planName: string;
};

type QueueConfig = {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  pendingCooldownMs: number;
  pendingMaxCooldownMs: number;
  maxBatch: number;
};

type ServerConfig = {
  appUrl: string;
  port: number;
};

type AppConfig = {
  core: ReturnType<typeof readCriticalEnv>;
  flags: AppFlags;
  billing: BillingConfig;
  queue: QueueConfig;
  server: ServerConfig;
};

let cachedConfig: AppConfig | null = null;
let cachedQueue: QueueConfig | null = null;

const readBillingInterval = (value: string): BillingConfig["interval"] => {
  const v = value.toUpperCase();
  return v === "ANNUAL" ? "ANNUAL" : "EVERY_30_DAYS";
};

export const getAppConfig = (): AppConfig => {
  if (cachedConfig) return cachedConfig;

  const core = readCriticalEnv();
  const flags = readAppFlags();

  const amountRaw = process.env.BILLING_PRICE ?? "29";
  const amount = Number(amountRaw);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("BILLING_PRICE must be a positive number");
  }

  const currencyCode = (process.env.BILLING_CURRENCY || "USD").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currencyCode)) {
    throw new Error("BILLING_CURRENCY must be a three-letter ISO code");
  }

  const trialDays = readIntegerEnv("BILLING_TRIAL_DAYS", 14, 0)!;
  const interval = readBillingInterval(process.env.BILLING_INTERVAL || "EVERY_30_DAYS");
  const planName = (process.env.BILLING_PLAN_NAME || "AI Copilot Pro").trim();

  const billing: BillingConfig = { amount, currencyCode, trialDays, interval, planName };

  const queue: QueueConfig = {
    maxRetries: readIntegerEnv("WEBHOOK_MAX_RETRIES", 5, 0)!,
    baseDelayMs: readIntegerEnv("WEBHOOK_BASE_DELAY_MS", 500, 0)!,
    maxDelayMs: readIntegerEnv("WEBHOOK_MAX_DELAY_MS", 30000, 0)!,
    pendingCooldownMs: readIntegerEnv("WEBHOOK_PENDING_COOLDOWN_MS", 250, 0)!,
    pendingMaxCooldownMs: readIntegerEnv("WEBHOOK_PENDING_MAX_COOLDOWN_MS", 2000, 0)!,
    maxBatch: readIntegerEnv("WEBHOOK_MAX_BATCH", 50, 1)!,
  };

  const server: ServerConfig = {
    appUrl: core.SHOPIFY_APP_URL,
    port: readIntegerEnv("PORT", 3000, 1)!,
  };

  cachedConfig = { core, flags, billing, queue, server };
  return cachedConfig;
};

export const getQueueConfig = (): QueueConfig => {
  if (cachedQueue) return cachedQueue;
  cachedQueue = {
    maxRetries: readIntegerEnv("WEBHOOK_MAX_RETRIES", 5, 0)!,
    baseDelayMs: readIntegerEnv("WEBHOOK_BASE_DELAY_MS", 500, 0)!,
    maxDelayMs: readIntegerEnv("WEBHOOK_MAX_DELAY_MS", 30000, 0)!,
    pendingCooldownMs: readIntegerEnv("WEBHOOK_PENDING_COOLDOWN_MS", 250, 0)!,
    pendingMaxCooldownMs: readIntegerEnv("WEBHOOK_PENDING_MAX_COOLDOWN_MS", 2000, 0)!,
    maxBatch: readIntegerEnv("WEBHOOK_MAX_BATCH", 50, 1)!,
  };
  return cachedQueue;
};
