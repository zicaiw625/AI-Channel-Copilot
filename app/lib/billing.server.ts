import { requireEnv } from "./env.server";
import { logger } from "./logger.server";

type AdminGraphqlClient = {
  graphql: (
    query: string,
    options: { variables?: Record<string, unknown>; signal?: AbortSignal },
  ) => Promise<Response>;
};

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

const APP_SUBSCRIPTION_CREATE_MUTATION = `#graphql
  mutation AppSubscriptionCreate($name: String!, $trialDays: Int, $returnUrl: URL!, $amount: Decimal!, $currencyCode: CurrencyCode!, $interval: AppRecurringPricingInterval!) {
    appSubscriptionCreate(
      name: $name,
      trialDays: $trialDays,
      returnUrl: $returnUrl,
      lineItems: [
        {
          plan: {
            appRecurringPricingDetails: {
              price: { amount: $amount, currencyCode: $currencyCode },
              interval: $interval
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
): Promise<boolean> => {
  const response = await admin.graphql(ACTIVE_SUBSCRIPTIONS_QUERY, {});
  if (!response.ok) return false;
  const json = (await response.json()) as {
    data?: { currentAppInstallation?: { activeSubscriptions?: { id: string; name: string; status: string }[] } };
  };
  const list = json.data?.currentAppInstallation?.activeSubscriptions || [];
  return list.some((s) => s.name === planName && s.status === "ACTIVE");
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

  const ok = await hasActiveSubscription(admin, planName);
  if (ok) return;

  const returnUrl = `${appUrl}/app/billing/confirm`;
  const response = await admin.graphql(APP_SUBSCRIPTION_CREATE_MUTATION, {
    variables: {
      name: planName,
      trialDays,
      returnUrl,
      amount,
      currencyCode,
      interval,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    logger.error("[billing] appSubscriptionCreate failed", { shopDomain }, { message: text });
    throw new Error(`Billing setup failed: ${response.status}`);
  }

  const json = (await response.json()) as {
    data?: { appSubscriptionCreate?: { confirmationUrl?: string | null; userErrors?: { field?: string[]; message: string }[] } };
  };
  const confirmationUrl = json.data?.appSubscriptionCreate?.confirmationUrl || null;
  if (!confirmationUrl) {
    const err = (json.data?.appSubscriptionCreate?.userErrors || []).map((e) => e.message).join("; ");
    logger.error("[billing] confirmationUrl missing", { shopDomain }, { errors: err });
    throw new Error("Billing confirmation URL not available");
  }

  throw new Response(null, { status: 302, headers: { Location: confirmationUrl } });
};

