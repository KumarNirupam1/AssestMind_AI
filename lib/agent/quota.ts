import { DAILY_TOKEN_BUDGET, TURN_TOKEN_BUDGET } from "./limits.ts";

/**
 * Per-user daily token quota (architecture §3.3) enforced server-side, before
 * the model is ever called.
 *
 * The store is injectable so the enforcement logic is unit-testable without
 * Postgres. The default is a per-process in-memory ledger: correct for a
 * single demo box and for CI, and deliberately weak across restarts. A
 * durable store (a `DailyUsage` ledger row per clerkUserId+date) is a Phase 7
 * deployment concern and belongs in a migration approved then — swapping it
 * in means implementing the same two methods against Prisma, nothing else.
 */

export type UsageStore = {
  /** Tokens already drawn today for this resource. */
  consumedToday(resource: string, now: Date): number;
  /** Draw `amount` tokens for today, returning the new running total. */
  add(resource: string, amount: number, now: Date): number;
};

/**
 * In-memory ledger. One counter per resource, keyed to a UTC day string, so
 * the counter rolls over at midnight without any background cleanup.
 * (A per-process store has no cross-restart memory; see the module note.)
 */
export function createInMemoryUsageStore(): UsageStore {
  const totals = new Map<string, number>();

  const dayKey = (resource: string, now: Date) =>
    `${resource}:${now.toISOString().slice(0, 10)}`;

  return {
    consumedToday(resource, now) {
      return totals.get(dayKey(resource, now)) ?? 0;
    },
    add(resource, amount, now) {
      const key = dayKey(resource, now);
      const next = (totals.get(key) ?? 0) + amount;
      totals.set(key, next);
      return next;
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
export function reserveTurnBudget(
  store: UsageStore,
  resource: string,
  now = new Date(),
  turnBudget = TURN_TOKEN_BUDGET,
  dailyLimit = DAILY_TOKEN_BUDGET,
): QuotaDecision {
  const used = store.consumedToday(resource, now);

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

  const next = store.add(resource, turnBudget, now);
  return { allowed: true, used: next, limit: dailyLimit };
}