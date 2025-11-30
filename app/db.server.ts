import { PrismaClient } from "@prisma/client";
import { requireEnv } from "./lib/env.server";
import { logger } from "./lib/logger.server";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient | undefined;
}

const rawDatabaseUrl = requireEnv("DATABASE_URL");
let databaseUrl = rawDatabaseUrl;

try {
  const parsed = new URL(rawDatabaseUrl);
  const sslMode = parsed.searchParams.get("sslmode")?.toLowerCase();
  const sslFlag = parsed.searchParams.get("ssl")?.toLowerCase();
  const hasTls = sslMode === "require" || sslFlag === "true";
  if (process.env.NODE_ENV === "production" && !hasTls) {
    parsed.searchParams.set("sslmode", "require");
    databaseUrl = parsed.toString();
    logger.info("[db] Applied sslmode=require to DATABASE_URL for production safety");
  }
} catch {
  // keep raw url
}

const validateDatabaseSecurity = () => {
  if (process.env.NODE_ENV === "test") return;

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch (error) {
    logger.warn("[db] Unable to parse DATABASE_URL for security checks", undefined, { error });
    return;
  }

  const sslMode = parsed.searchParams.get("sslmode")?.toLowerCase();
  const sslFlag = parsed.searchParams.get("ssl")?.toLowerCase();
  const hasTls = sslMode === "require" || sslFlag === "true";
  const requireTls = process.env.DB_REQUIRE_SSL !== "false";

  const allowedHosts = process.env.DB_ALLOWED_HOSTS?.split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  const host = parsed.hostname.toLowerCase();

  if (allowedHosts?.length && !allowedHosts.includes(host)) {
    throw new Error(
      `[db] DATABASE_URL host "${host}" is not listed in DB_ALLOWED_HOSTS; restrict DB access to app nodes only.`,
    );
  }

  if (requireTls && process.env.NODE_ENV === "production" && !hasTls) {
    throw new Error(
      "[db] Production DATABASE_URL must set sslmode=require or ssl=true to enforce TLS + encrypted storage.",
    );
  }

  if (!hasTls && process.env.NODE_ENV !== "production") {
    logger.warn(
      "[db] DATABASE_URL missing ssl/sslmode; enable TLS for non-local databases.",
      { host },
    );
  }
};

validateDatabaseSecurity();

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
