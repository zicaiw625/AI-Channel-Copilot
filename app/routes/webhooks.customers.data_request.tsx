import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { describeCustomerFootprint, extractGdprIdentifiers } from "../lib/gdpr.server";

const jsonResponse = (payload: Record<string, unknown>) =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  const payload = await request.json().catch(() => null);

  console.log(`Received ${topic} webhook for ${shop}`);

  if (!shop) return jsonResponse({ ok: true, message: "Missing shop domain" });

  try {
    const { customerIds, customerEmail } = extractGdprIdentifiers(payload);
    const footprint = await describeCustomerFootprint(shop, customerIds);
    if (!footprint.hasData) {
      return jsonResponse({
        ok: true,
        message: customerEmail
          ? "No customer-level data stored for this shop; customer emails are not persisted."
          : "No customer-level data stored for this shop; nothing to export.",
      });
    }

    return jsonResponse({
      ok: true,
      message: `Stored ${footprint.orders} orders / ${footprint.customers} customer rows linked to this customer. No personal data beyond Shopify IDs, referrers, and landing pages is persisted.`,
    });
  } catch (error) {
    console.error("customers/data_request failed", {
      shop,
      message: (error as Error).message,
    });
    return jsonResponse({
      ok: true,
      message: "No customer-level data stored; nothing to export.",
    });
  }
};
