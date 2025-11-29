import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  let shopDomain = "";

  try {
    const { payload, session, topic, shop } = await authenticate.webhook(request);
    shopDomain = shop;
    console.log(`Received ${topic} webhook for ${shop}`);

    const currentRaw = (payload as { current?: unknown }).current;
    const current = Array.isArray(currentRaw)
      ? currentRaw.filter((value): value is string => typeof value === "string")
      : [];

    if (session && current.length) {
      await db.session.update({
        where: {
          id: session.id,
        },
        data: {
          scope: current.toString(),
        },
      });
    }

    return new Response();
  } catch (error) {
    console.error("app/scopes_update webhook failed", {
      shop: shopDomain,
      message: (error as Error).message,
    });
    return new Response(undefined, { status: 202 });
  }
};
