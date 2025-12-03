 
import type { LoaderFunctionArgs } from "react-router";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { isDemoMode } from "../lib/runtime.server";

type JobStatus = "queued" | "processing" | "completed" | "failed";
interface JobSnapshot {
  ok: boolean;
  backfills: {
    recent: Array<Record<string, unknown>>;
    counts: Partial<Record<JobStatus, number>>;
  };
  webhooks: {
    recent: Array<Record<string, unknown>>;
    counts: Partial<Record<JobStatus, number>>;
  };
}

let cached: { shopDomain: string; payload: JobSnapshot } | null = null;
let cachedAt = 0;
const TTL_MS = 10_000;

const toCounts = (rows: { status: JobStatus; _count: { status: number } }[]) => {
  return rows.reduce<Partial<Record<JobStatus, number>>>((acc, row) => {
    acc[row.status] = row._count.status;
    return acc;
  }, {});
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  let session;
  try {
    const auth = await authenticate.admin(request);
    session = auth.session;
  } catch (error) {
    if (!isDemoMode()) throw error;
  }

  const shopDomain = session?.shop || "";
  // In demo mode, if we can't determine shop domain, return empty or mock data instead of 401
  if (!shopDomain && isDemoMode()) {
    // Return empty snapshot for demo
    return Response.json({
      ok: true,
      backfills: { recent: [], counts: {} },
      webhooks: { recent: [], counts: {} },
    });
  }

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

  const payload: JobSnapshot = {
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
