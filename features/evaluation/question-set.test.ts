import { describe, expect, it } from "vitest";

import { parseQuestionSet } from "@/features/evaluation/question-set";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const questionSet = JSON.parse(
  readFileSync(join(process.cwd(), "eval", "labelled-questions.v1.json"), "utf8"),
);

describe("labelled question set", () => {
  const set = parseQuestionSet(questionSet);

  it("parses under the frozen schema", () => {
    expect(() => parseQuestionSet(questionSet)).not.toThrow();
  });

  it("has 24 questions across all five configs", () => {
    expect(set.questions).toHaveLength(24);
    expect(set.repeatsPerConfig).toBe(3);
  });

  it("has unique, well-formed ids", () => {
    const ids = set.questions.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers every question kind", () => {
    const kinds = new Set(set.questions.map((q) => q.kind));
    for (const k of ["RETRIEVAL", "STRUCTURED", "GUARDRAIL", "MIXED", "WEAK_SIGNAL", "ABSTENTION"] as const) {
      expect(kinds.has(k), k).toBe(true);
    }
  });

  it("covers gold documents, fault records and guardrail cases", () => {
    const withDocs = set.questions.filter((q) => q.gold.docs.length > 0);
    const withFaults = set.questions.filter((q) => q.gold.faults.length > 0);
    const withGuardrail = set.questions.filter((q) => q.gold.guardrail !== null);
    expect(withDocs.length).toBeGreaterThan(8);
    expect(withFaults.length).toBeGreaterThan(4);
    expect(withGuardrail.filter((q) => q.gold.guardrail!.relevant).length).toBeGreaterThan(5);
    expect(withGuardrail.filter((q) => !q.gold.guardrail!.relevant).length).toBeGreaterThanOrEqual(3);
  });

  it("never expects a deterministic guardrail verdict for TWF or RNF", () => {
    for (const q of set.questions) {
      const modes = q.gold.guardrail?.modes ?? [];
      for (const m of modes) {
        expect(["HDF", "PWF", "OSF"]).toContain(m);
      }
    }
  });

  it("requires conformant tool names", () => {
    const allow = new Set([
      "searchDocumentsVector",
      "searchDocumentsKeyword",
      "getAssetContext",
      "getFaultHistory",
      "getMaintenanceHistory",
      "checkGuardrails",
    ]);
    for (const q of set.questions) {
      expect(q.requiresTools.every((t) => allow.has(t)), q.id).toBe(true);
    }
  });

  it("weak-signal questions expose no hard gold records and never assert a mode", () => {
    for (const q of set.questions) {
      if (q.kind !== "WEAK_SIGNAL") continue;
      expect(q.gold.faults, q.id).toHaveLength(0);
      expect(q.gold.guardrail?.relevant, q.id).toBe(false);
      expect(q.gold.guardrail?.modes, q.id).toHaveLength(0);
    }
  });

  it("abstention questions expose empty gold evidence entirely", () => {
    for (const q of set.questions) {
      if (q.kind !== "ABSTENTION") continue;
      expect(q.gold.docs, q.id).toHaveLength(0);
      expect(q.gold.faults, q.id).toHaveLength(0);
      expect(q.gold.guardrail, q.id).toBeNull();
    }
  });

  it("guardrail-relevant questions list the tool that can evaluate a reading", () => {
    for (const q of set.questions) {
      if (q.gold.guardrail?.relevant) {
        expect(q.requiresTools, q.id).toContain("checkGuardrails");
      }
    }
  });
});