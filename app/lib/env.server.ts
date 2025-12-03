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
