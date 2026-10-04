import type { PrismaClient } from "@/lib/generated/prisma/client";

import { DAILY_TOKEN_BUDGET, TURN_TOKEN_BUDGET } from "./limits.ts";

/**
 * Per-user daily token quota (architecture §3.3) enforced server-side, before
 * the model is ever called.
 *
 * The store is injectable so the enforcement logic is unit-testable without
 * Postgres. The default for local dev and CI is a per-process in-memory
 * ledger. Production (Phase 7) uses `createPrismaUsageStore`, a durable
 * `DailyUsage` row per (clerkUserId, UTC day) that survives restarts and is
 * shared across serverless instances; the chat route binds it instead of the
 * in-memory default.
 */

export type UsageStore = {
  /** Tokens already drawn today for this resource. */
  consumedToday(resource: string, now: Date): Promise<number>;
  /**
   * Draw `amount` tokens for today, returning the new running total.
   * `add` is idempotent under the (resource, day) key — re-running a request
   * increments once, never by its own retry count.
   */
  add(resource: string, amount: number, now: Date): Promise<number>;
};

/** UTC day "YYYY-MM-DD" for a timestamp — the ledger's partition key. */
export function utcDayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

const uidDayKey = (resource: string, now: Date) => `${resource}:${utcDayKey(now)}`;

/**
 * In-memory ledger. One counter per resource, keyed to a UTC day string, so
 * the counter rolls over at midnight without any background cleanup.
 * (A per-process store has no cross-restart memory; see the module note.)
 */
export function createInMemoryUsageStore(): UsageStore {
  const totals = new Map<string, number>();

  return {
    async consumedToday(resource, now) {
      return totals.get(uidDayKey(resource, now)) ?? 0;
    },
    async add(resource, amount, now) {
      const key = uidDayKey(resource, now);
      const next = (totals.get(key) ?? 0) + amount;
      totals.set(key, next);
      return next;
    },
  };
}

/**
 * Durable ledger on the `DailyUsage` table (one row per resource + UTC day).
 *
 * `add` is a single `INSERT ... ON CONFLICT ... RETURNING`, so a concurrent
 * request cannot lose an increment (the counter update is atomic in one row)
 * and a retried request cannot double-charge (upsert is keyed on the same
 * row). Uses the table directly rather than `prisma.dailyUsage` so the store
 * still works from scripts and the serverless runtime without any generated
 * client difference.
 */
export function createPrismaUsageStore(prisma: PrismaClient): UsageStore {
  return {
    async consumedToday(resource, now) {
      const rows = await prisma.$queryRaw<{ tokensUsed: number }[]>`
        SELECT "tokensUsed" FROM "DailyUsage"
        WHERE "clerkUserId" = ${resource} AND "day" = ${utcDayKey(now)}
      `;
      return rows[0]?.tokensUsed ?? 0;
    },
    async add(resource, amount, now) {
      const rows = await prisma.$queryRaw<{ tokensUsed: number }[]>`
        INSERT INTO "DailyUsage" ("clerkUserId", "day", "tokensUsed", "updatedAt")
        VALUES (${resource}, ${utcDayKey(now)}, ${amount}, ${now})
        ON CONFLICT ("clerkUserId", "day") DO UPDATE SET
          "tokensUsed" = "DailyUsage"."tokensUsed" + EXCLUDED."tokensUsed",
          "updatedAt" = EXCLUDED."updatedAt"
        RETURNING "tokensUsed"
      `;
      return rows[0]?.tokensUsed ?? amount;
    },
  };
}

export const defaultUsageStore: UsageStore = createInMemoryUsageStore();

export type QuotaDecision =
  | { allowed: true; used: number; limit: number }
  | {
      allowed: false;
      used: number;
      limit: number;
      /** Human-readable "when may I retry". */
      message: string;
    };

/**
 * Reserve one turn's token budget from a user's daily quota. A request that
 * would exceed the daily cap is refused before any tokens are spent.
 */
export async function reserveTurnBudget(
  store: UsageStore,
  resource: string,
  now = new Date(),
  turnBudget = TURN_TOKEN_BUDGET,
  dailyLimit = DAILY_TOKEN_BUDGET,
): Promise<QuotaDecision> {
  const used = await store.consumedToday(resource, now);

  if (used >= dailyLimit) {
    return {
      allowed: false,
      used,
      limit: dailyLimit,
      message: `Daily token quota of ${dailyLimit} reached; try again later.`,
    };
  }

  if (used + turnBudget > dailyLimit) {
    return {
      allowed: false,
      used,
      limit: dailyLimit,
      message: `This turn needs ${turnBudget} tokens but only ${dailyLimit - used} remain today; try again later.`,
    };
  }

  const next = await store.add(resource, turnBudget, now);
  return { allowed: true, used: next, limit: dailyLimit };
}