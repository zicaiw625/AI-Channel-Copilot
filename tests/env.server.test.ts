import { describe, it, expect } from "vitest";
import { getAppConfig, readAppFlags, readCriticalEnv } from "../app/lib/env.server";

describe("env config", () => {
  it("reads critical env and validates types", () => {
    process.env.SHOPIFY_API_KEY = "key";
    process.env.SHOPIFY_API_SECRET = "secret";
    process.env.SHOPIFY_APP_URL = "https://app.example.com";
    process.env.SCOPES = "read_products,write_products";
    const crit = readCriticalEnv();
    expect(crit.SHOPIFY_API_KEY).toBe("key");
    expect(crit.SHOPIFY_APP_URL).toBe("https://app.example.com/");
    expect(Array.isArray(crit.SCOPES)).toBe(true);
  });

  it("builds app config with defaults", () => {
    process.env.BILLING_PRICE = "29";
    process.env.BILLING_CURRENCY = "usd";
    process.env.BILLING_TRIAL_DAYS = "14";
    process.env.BILLING_INTERVAL = "EVERY_30_DAYS";
    process.env.BILLING_PLAN_NAME = "AI Copilot Pro";
    process.env.WEBHOOK_MAX_RETRIES = "5";
    process.env.WEBHOOK_BASE_DELAY_MS = "500";
    process.env.WEBHOOK_MAX_DELAY_MS = "30000";
    process.env.WEBHOOK_PENDING_COOLDOWN_MS = "250";
    process.env.WEBHOOK_PENDING_MAX_COOLDOWN_MS = "2000";
    process.env.WEBHOOK_MAX_BATCH = "50";

    const cfg = getAppConfig();
    expect(cfg.billing.currencyCode).toBe("USD");
    expect(cfg.billing.interval).toBe("EVERY_30_DAYS");
    expect(cfg.queue.maxRetries).toBe(5);
    expect(cfg.queue.maxBatch).toBe(50);
  });

  it("reads feature flags with defaults", () => {
    delete process.env.DEMO_MODE;
    const flags = readAppFlags();
    expect(typeof flags.demoMode).toBe("boolean");
  });
});
