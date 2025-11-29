#!/usr/bin/env node
import crypto from "crypto";
import { setTimeout as delay } from "timers/promises";

const {
  SHOPIFY_STORE_DOMAIN,
  SHOPIFY_ADMIN_TOKEN,
  SHOPIFY_API_SECRET,
  APP_WEBHOOK_URL = "http://localhost:3000/webhooks/orders/create",
  APP_WEBHOOK_UPDATE_URL = "http://localhost:3000/webhooks/orders/updated",
} = process.env;

const requireEnv = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
};

const graphql = async (query, variables = {}) => {
  const domain = requireEnv("SHOPIFY_STORE_DOMAIN");
  const token = requireEnv("SHOPIFY_ADMIN_TOKEN");
  const res = await fetch(`https://${domain}/admin/api/2025-01/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GraphQL request failed (${res.status}): ${text}`);
  }

  const body = await res.json();
  if (body.errors?.length) {
    throw new Error(`GraphQL error: ${body.errors[0].message}`);
  }

  return body.data;
};

const pickVariant = async () => {
  const data = await graphql(
    /* GraphQL */ `
    query regressionVariant {
      products(first: 1) {
        edges {
          node {
            variants(first: 1) {
              edges {
                node { id title }
              }
            }
          }
        }
      }
    }
  `,
  );

  const variant = data?.products?.edges?.[0]?.node?.variants?.edges?.[0]?.node;
  if (!variant?.id) {
    throw new Error("No product variants available in the dev store to seed test orders");
  }
  return variant.id;
};

const createOrder = async (variantId, index, extra) => {
  const landingPage = `https://demo.ai-channel.dev/?utm_source=${extra.utmSource}&utm_medium=${extra.utmMedium}`;
  const referrer = `https://referrer-${index}.ai-search.com/query?q=shoes`;
  const data = await graphql(
    /* GraphQL */ `
      mutation regressionOrder($input: OrderInput!) {
        orderCreate(input: $input) {
          order { id name customerUrl landingPageUrl note }
          userErrors { field message }
        }
      }
    `,
    {
      input: {
        test: true,
        sourceName: "ai-regression",
        lineItems: [{ variantId, quantity: 1 }],
        tags: ["ai-regression", `utm:${extra.utmSource}/${extra.utmMedium}`],
        note: extra.note,
        landingPageUrl: landingPage,
        customerLocale: "en",
        shippingAddress: {
          address1: "1 Test Street",
          city: "Testville",
          countryCode: "US",
          zip: "00000",
          name: "AI Regression",
        },
      },
    },
  );

  const { order, userErrors } = data.orderCreate;
  if (userErrors?.length) {
    throw new Error(`Failed to create order: ${userErrors.map((e) => e.message).join(", ")}`);
  }
  return { ...order, landingPage, referrer };
};

const signWebhook = (body) => {
  if (!SHOPIFY_API_SECRET) return null;
  return crypto.createHmac("sha256", SHOPIFY_API_SECRET).update(body, "utf8").digest("base64");
};

const postWebhook = async (url, topic, orderPayload) => {
  const body = JSON.stringify(orderPayload);
  const hmac = signWebhook(body);
  const headers = {
    "Content-Type": "application/json",
    "X-Shopify-Topic": topic,
    "X-Shopify-Shop-Domain": SHOPIFY_STORE_DOMAIN || "",
  };
  if (hmac) headers["X-Shopify-Hmac-Sha256"] = hmac;

  const res = await fetch(url, { method: "POST", headers, body });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Webhook POST failed (${res.status}): ${text}`);
  }
};

const buildWebhookOrder = (order) => ({
  id: order.id,
  name: order.name,
  landing_site: order.landingPage,
  landing_site_ref: order.landingPage,
  referring_site: order.referrer,
  source_name: "web",
  current_total_price: "10.00",
  total_price: "10.00",
  total_price_set: {
    shop_money: { amount: "10.00", currency_code: "USD" },
    presentment_money: { amount: "10.00", currency_code: "USD" },
  },
  currency: "USD",
  subtotal_price: "10.00",
  customer: order.customer || null,
  created_at: new Date().toISOString(),
});

const scenarios = [
  { utmSource: "chatgpt", utmMedium: "ai", note: "AI UTM order" },
  { utmSource: "perplexity", utmMedium: "ai", note: "Search referrer order" },
];

const main = async () => {
  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_TOKEN) {
    throw new Error(
      "SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_TOKEN must be set to generate real test orders",
    );
  }

  const variantId = await pickVariant();
  console.log(`Using variant ${variantId} for regression orders`);

  for (let i = 0; i < scenarios.length; i += 1) {
    const scenario = scenarios[i];
    console.log(`Creating order ${i + 1} with utm_source=${scenario.utmSource}`);
    const order = await createOrder(variantId, i, scenario);

    const webhookPayload = buildWebhookOrder(order);
    await postWebhook(APP_WEBHOOK_URL, "orders/create", webhookPayload);
    await delay(250);
    await postWebhook(APP_WEBHOOK_UPDATE_URL, "orders/updated", webhookPayload);
  }

  console.log("Regression orders created and webhooks dispatched. Wait for dashboard ingestion to verify results.");
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
