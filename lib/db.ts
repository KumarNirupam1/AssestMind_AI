import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "./generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Remove libpq-only query params from the connection string.
 *
 * `pg` does not understand `sslmode`/`channel_binding` (SSL is configured on
 * the Pool below). Strip them by key instead of by string replace: a plain
 * `.replace("?sslmode=require", "")` leaves `&channel_binding=require` glued
 * to the database name, which makes Postgres look for a database literally
 * named `neondb&channel_binding=require`.
 */
function connectionStringFrom(url: string): string {
  const trimmed = url.trim().replace(/^['"]|['"]$/g, "");
  const queryStart = trimmed.indexOf("?");
  if (queryStart === -1) return trimmed;

  const base = trimmed.slice(0, queryStart);
  const kept = trimmed
    .slice(queryStart + 1)
    .split("&")
    .filter((pair) => {
      const key = pair.split("=")[0];
      return key !== "sslmode" && key !== "channel_binding";
    });

  return kept.length > 0 ? `${base}?${kept.join("&")}` : base;
}

function createPrismaClient() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }

  const pool = new Pool({
    connectionString: connectionStringFrom(url),
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    idleTimeoutMillis: 30_000,
    // Neon's free tier suspends when idle; the first connection after a pause
    // can take several seconds, so a 5s connect timeout fails spuriously.
    connectionTimeoutMillis: 15_000,
    allowExitOnIdle: true,
    ssl: { rejectUnauthorized: false }
  });

  const adapter = new PrismaPg(pool, {
    disposeExternalPool: true,
    onPoolError: (err) => console.error("pg pool error", err),
  });

  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
