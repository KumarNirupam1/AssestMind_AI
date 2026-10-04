import { describe, expect, it } from "vitest";

import { buildRunId, usageToSchema } from "@/features/evaluation/runner";

describe("buildRunId", () => {
  it("pins question, config and repeat in a stable order", () => {
    expect(buildRunId("q001", 5, 3)).toBe("q001-c5-r3");
    expect(buildRunId("q023", 1, 1)).toBe("q023-c1-r1");
  });

  it("produces the exact 360 expected ids for the 24x5x3 grid", () => {
    const ids = new Set<string>();
    const questions = Array.from({ length: 24 }, (_, i) => `q${String(i + 1).padStart(3, "0")}`);
    for (const q of questions) {
      for (let config = 1; config <= 5; config++) {
        for (let r = 1; r <= 3; r++) ids.add(buildRunId(q, config, r));
      }
    }
    expect(ids.size).toBe(360);
    expect(ids.has("q001-c1-r1")).toBe(true);
    expect(ids.has("q024-c5-r3")).toBe(true);
  });
});

describe("usageToSchema", () => {
  it("maps v7 input/output token names onto the frozen schema", () => {
    expect(usageToSchema({ inputTokens: 10, outputTokens: 5, totalTokens: 15 })).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
  });

  it("derives totalTokens when the provider omits it", () => {
    expect(usageToSchema({ inputTokens: 7, outputTokens: 2 })).toEqual({
      promptTokens: 7,
      completionTokens: 2,
      totalTokens: 9,
    });
  });

  it("degrades a missing usage to zeroes rather than NaN", () => {
    expect(usageToSchema({})).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  });
});