export const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === null || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
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

export const readCriticalEnv = () => {
  const SHOPIFY_API_KEY = requireEnv("SHOPIFY_API_KEY");
  const SHOPIFY_API_SECRET = requireEnv("SHOPIFY_API_SECRET");
  const SHOPIFY_APP_URL = validateAppUrl(requireEnv("SHOPIFY_APP_URL"));
  const SCOPES = requireEnv("SCOPES")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!SCOPES.length) {
    throw new Error("SCOPES must not be empty");
  }
  return { SHOPIFY_API_KEY, SHOPIFY_API_SECRET, SHOPIFY_APP_URL, SCOPES } as const;
};
