import { describe, expect, it, vi } from "vitest";

import { fail, ok } from "@/lib/agent/types";
import { clampCount, runWithTimeoutAndRetry } from "@/lib/agent/limits";

describe("clampCount", () => {
  it("falls back when no limit is supplied", () => {
    expect(clampCount(undefined, 5, 10)).toBe(5);
  });

  it("falls back for non-positive or non-finite input", () => {
    expect(clampCount(0, 5, 10)).toBe(5);
    expect(clampCount(-3, 5, 10)).toBe(5);
    expect(clampCount(Number.NaN, 5, 10)).toBe(5);
    expect(clampCount(Number.POSITIVE_INFINITY, 5, 10)).toBe(5);
  });

  it("caps at the maximum and floors fractions", () => {
    expect(clampCount(100, 5, 10)).toBe(10);
    expect(clampCount(7.9, 5, 10)).toBe(7);
  });

  it("returns the requested count when within bounds", () => {
    expect(clampCount(4, 5, 10)).toBe(4);
  });
});

describe("runWithTimeoutAndRetry", () => {
  const timeoutMs = 50;

  it("returns a successful outcome immediately", async () => {
    const fn = vi.fn(async () => ok({ n: 1 }));
    const outcome = await runWithTimeoutAndRetry(fn, timeoutMs);
    expect(outcome).toEqual({ ok: true, data: { n: 1 } });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("converts an unexpected throw into UPSTREAM — a tool must be able to fail without killing the stream", async () => {
    const fn = vi.fn(async () => {
      throw new Error("boom");
    });
    const outcome = await runWithTimeoutAndRetry(fn, timeoutMs);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("UPSTREAM");
      expect(outcome.error.message).toContain("boom");
    }
  });

  it("passes an ok:false outcome through unchanged — the model's information, not a fault", async () => {
    const fn = vi.fn(async () => fail("NOT_FOUND", "No such asset"));
    const outcome = await runWithTimeoutAndRetry(fn, timeoutMs);
    expect(outcome).toEqual({ ok: false, error: { code: "NOT_FOUND", message: "No such asset" } });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries once on timeout, then returns the second attempt's outcome", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const fn = vi.fn(async () => {
        calls += 1;
        if (calls === 1) return new Promise<never>(() => {});
        return ok("late");
      });

      const pending = runWithTimeoutAndRetry(fn, 10);
      await vi.advanceTimersByTimeAsync(10);
      const outcome = await pending;

      expect(fn).toHaveBeenCalledTimes(2);
      expect(outcome).toEqual({ ok: true, data: "late" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("degrades to TIMEOUT when both attempts never resolve", async () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn(async () => new Promise<never>(() => {}));

      const pending = runWithTimeoutAndRetry(fn, 10);
      await vi.advanceTimersByTimeAsync(10);
      await vi.advanceTimersByTimeAsync(10);
      const outcome = await pending;

      expect(fn).toHaveBeenCalledTimes(2);
      expect(outcome).toEqual({
        ok: false,
        error: { code: "TIMEOUT", message: expect.stringContaining("10 ms") },
      });
    } finally {
      vi.useRealTimers();
    }
  });
});