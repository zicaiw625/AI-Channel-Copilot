 
import type { LoaderFunctionArgs } from "react-router";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";

let cached: any | null = null;
let cachedAt = 0;
const TTL_MS = 10_000;

const toCounts = (rows: { status: string; _count: { status: number } }[]) => {
  return rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = row._count.status;
    return acc;
  }, {});
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session?.shop || "";
  if (!shopDomain) {
    return Response.json({ ok: false, message: "unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  if (cached && now - cachedAt < TTL_MS && cached.shopDomain === shopDomain) {
    return Response.json(cached.payload);
  }

  const [backfillRows, webhookRows, backfillCounts, webhookCounts] = await Promise.all([
    prisma.backfillJob.findMany({
      where: { shopDomain },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
    prisma.webhookJob.findMany({
      where: { shopDomain },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
    prisma.backfillJob.groupBy({
      by: ["status"],
      _count: { status: true },
      where: { shopDomain },
    }),
    prisma.webhookJob.groupBy({
      by: ["status"],
      _count: { status: true },
      where: { shopDomain },
    }),
  ]);

  const payload = {
    ok: true,
    backfills: {
      recent: backfillRows,
      counts: toCounts(backfillCounts),
    },
    webhooks: {
      recent: webhookRows,
      counts: toCounts(webhookCounts),
    },
  };
  cached = { shopDomain, payload };
  cachedAt = now;
  return Response.json(payload);
};
