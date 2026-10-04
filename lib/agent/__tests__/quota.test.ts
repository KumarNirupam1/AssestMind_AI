import { describe, expect, it } from "vitest";

import {
  createInMemoryUsageStore,
  reserveTurnBudget,
  utcDayKey,
} from "@/lib/agent/quota";

const t = (iso: string) => new Date(iso);

describe("utcDayKey", () => {
  it("uses UTC regardless of local timezone", () => {
    expect(utcDayKey(t("2026-09-29T23:59:00Z"))).toBe("2026-09-29");
    expect(utcDayKey(t("2026-09-30T00:01:00Z"))).toBe("2026-09-30");
  });
});

describe("createInMemoryUsageStore", () => {
  it("rolls the counter over at UTC midnight", async () => {
    const store = createInMemoryUsageStore();
    await store.add("chat:u1", 1000, t("2026-09-29T23:59:00Z"));
    expect(await store.consumedToday("chat:u1", t("2026-09-29T23:59:00Z"))).toBe(1000);
    expect(await store.consumedToday("chat:u1", t("2026-09-30T00:01:00Z"))).toBe(0);
  });

  it("keeps distinct resources separate", async () => {
    const store = createInMemoryUsageStore();
    await store.add("chat:u1", 500, t("2026-09-29T12:00:00Z"));
    expect(await store.consumedToday("chat:u2", t("2026-09-29T12:00:00Z"))).toBe(0);
  });
});

describe("reserveTurnBudget", () => {
  const turnBudget = 40_000;
  const dailyLimit = 100_000;

  it("draws the turn budget and reports the running total", async () => {
    const store = createInMemoryUsageStore();
    const decision = await reserveTurnBudget(store, "chat:u1", t("2026-09-29T12:00:00Z"), turnBudget, dailyLimit);
    expect(decision).toMatchObject({ allowed: true, used: turnBudget, limit: dailyLimit });
    expect(await store.consumedToday("chat:u1", t("2026-09-29T12:00:00Z"))).toBe(turnBudget);
  });

  it("refuses when the daily cap is already reached", async () => {
    const store = createInMemoryUsageStore();
    await store.add("chat:u1", dailyLimit, t("2026-09-29T12:00:00Z"));
    const decision = await reserveTurnBudget(store, "chat:u1", t("2026-09-29T12:00:00Z"), turnBudget, dailyLimit);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.message).toContain("quota");
  });

  it("refuses when this turn does not fit in the remainder", async () => {
    const store = createInMemoryUsageStore();
    await store.add("chat:u1", dailyLimit - 10_000, t("2026-09-29T12:00:00Z"));
    const decision = await reserveTurnBudget(store, "chat:u1", t("2026-09-29T12:00:00Z"), turnBudget, dailyLimit);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.message).toContain("remain today");
  });

  it("neither spend tokens nor touch the ledger on a denied request", async () => {
    const store = createInMemoryUsageStore();
    await store.add("chat:u1", dailyLimit, t("2026-09-29T12:00:00Z"));
    const before = await store.consumedToday("chat:u1", t("2026-09-29T12:00:00Z"));
    expect((await reserveTurnBudget(store, "chat:u1", t("2026-09-29T12:00:00Z"), turnBudget, dailyLimit)).allowed).toBe(false);
    expect(await store.consumedToday("chat:u1", t("2026-09-29T12:00:00Z"))).toBe(before);
  });

  it("resets the cap on a new day", async () => {
    const store = createInMemoryUsageStore();
    expect((await reserveTurnBudget(store, "chat:u1", t("2026-09-29T23:59:00Z"), turnBudget, dailyLimit)).allowed).toBe(true);
    expect((await reserveTurnBudget(store, "chat:u1", t("2026-09-30T00:00:00Z"), turnBudget, dailyLimit)).allowed).toBe(true);
  });
});