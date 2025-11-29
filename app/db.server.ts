import { PrismaClient } from "@prisma/client";
import { requireEnv } from "./lib/env.server";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient | undefined;
}

const databaseUrl = requireEnv("DATABASE_URL");

const warnIfDatabaseInsecure = () => {
  if (process.env.NODE_ENV === "test") return;

  const normalized = databaseUrl.toLowerCase();
  const isLocal = normalized.includes("localhost") || normalized.includes("127.0.0.1");
  const hasSsl = normalized.includes("sslmode=") || normalized.includes("ssl=true");

  if (process.env.NODE_ENV === "production" && !isLocal && !hasSsl) {
    console.warn("[db] DATABASE_URL missing ssl/sslmode; enable TLS + disk encryption per security checklist");
  }
};

warnIfDatabaseInsecure();

const createPrismaClient = () =>
  new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  });

const prisma = globalThis.prismaGlobal ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.prismaGlobal = prisma;
}

export default prisma;
