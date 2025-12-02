import { requireEnv } from "./env.server";
import { logger } from "./logger.server";
import { createGraphqlSdk, type AdminGraphqlClient } from "./graphqlSdk.server";

const ACTIVE_SUBSCRIPTIONS_QUERY = `#graphql
  query ActiveSubscriptions {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
      }
    }
  }
`;

const buildAppSubscriptionCreateMutation = (intervalEnum: string) => `#graphql
  mutation AppSubscriptionCreate($name: String!, $trialDays: Int, $returnUrl: URL!, $amount: Decimal!, $currencyCode: CurrencyCode!) {
    appSubscriptionCreate(
      name: $name,
      trialDays: $trialDays,
      returnUrl: $returnUrl,
      lineItems: [
        {
          plan: {
            appRecurringPricingDetails: {
              price: { amount: $amount, currencyCode: $currencyCode },
              interval: ${intervalEnum}
            }
          }
        }
      ]
    ) {
      appSubscription { id name status }
      confirmationUrl
      userErrors { field message }
    }
  }
`;

const getEnvOrDefault = (name: string, fallback: string) => {
  const value = process.env[name];
  return value === undefined || value === null || value === "" ? fallback : value;
};

const toNumber = (value: string, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export const hasActiveSubscription = async (
  admin: AdminGraphqlClient,
  planName: string,
  shopDomain?: string,
): Promise<boolean> => {
  try {
    const sdk = createGraphqlSdk(admin, shopDomain);
    const response = await sdk.request("activeSubscriptions", ACTIVE_SUBSCRIPTIONS_QUERY, {});
    if (!response.ok) return false;
    const json = (await response.json()) as {
      data?: { currentAppInstallation?: { activeSubscriptions?: { id: string; name: string; status: string }[] } };
    };
    const list = json.data?.currentAppInstallation?.activeSubscriptions || [];
    return list.some((s) => s.name === planName && s.status === "ACTIVE");
  } catch (error) {
    const message = (error as Error)?.message || "unknown error";
    if (message.includes("Missing access token")) return false;
    logger.warn("[billing] hasActiveSubscription failed", {}, { message });
    return false;
  }
};

export const ensureBilling = async (
  admin: AdminGraphqlClient,
  shopDomain: string,
  request: Request,
) => {
  const planName = getEnvOrDefault("BILLING_PLAN_NAME", "AI Channel Copilot Basic");
  const amount = toNumber(getEnvOrDefault("BILLING_PRICE", "5"), 5);
  const currencyCode = getEnvOrDefault("BILLING_CURRENCY", "USD");
  const trialDays = toNumber(getEnvOrDefault("BILLING_TRIAL_DAYS", "7"), 7);
  const interval = getEnvOrDefault("BILLING_INTERVAL", "EVERY_30_DAYS");
  const appUrl = requireEnv("SHOPIFY_APP_URL");
  void request;

  const validInterval = interval === "ANNUAL" || interval === "EVERY_30_DAYS";
  const validCurrency = /^[A-Z]{3}$/.test(currencyCode);
  const validAmount = amount > 0 && Number.isFinite(amount);
  const validTrial = trialDays >= 0 && Number.isInteger(trialDays);
  if (process.env.NODE_ENV === "production") {
    if (!validInterval || !validCurrency || !validAmount || !validTrial) {
      throw new Error("Invalid billing configuration");
    }
  }

  const ok = await hasActiveSubscription(admin, planName, shopDomain);
  if (ok) return;

  try {
    const returnUrl = `${appUrl}/app/billing/confirm`;
    const normalizedInterval = interval === "ANNUAL" ? "ANNUAL" : "EVERY_30_DAYS";
    const sdk = createGraphqlSdk(admin, shopDomain);
    const response = await sdk.request(
      "appSubscriptionCreate",
      buildAppSubscriptionCreateMutation(normalizedInterval),
      {
        name: planName,
        trialDays,
        returnUrl,
        amount,
        currencyCode,
      },
    );

    if (!response.ok) {
      const text = await response.text();
      logger.error("[billing] appSubscriptionCreate failed", { shopDomain }, { message: text });
      return;
    }

    const json = (await response.json()) as {
      data?: { appSubscriptionCreate?: { confirmationUrl?: string | null; userErrors?: { field?: string[]; message: string }[] } };
    };
    const confirmationUrl = json.data?.appSubscriptionCreate?.confirmationUrl || null;
    if (!confirmationUrl) {
      const err = (json.data?.appSubscriptionCreate?.userErrors || []).map((e) => e.message).join("; ");
      logger.error("[billing] confirmationUrl missing", { shopDomain }, { errors: err });
      return;
    }

    throw new Response(null, { status: 302, headers: { Location: confirmationUrl } });
  } catch (error) {
    const message = (error as Error)?.message || "unknown error";
    if (error instanceof Response) throw error;
    if (message.includes("Missing access token")) return;
    logger.warn("[billing] ensureBilling failed", { shopDomain }, { message });
  }
};
