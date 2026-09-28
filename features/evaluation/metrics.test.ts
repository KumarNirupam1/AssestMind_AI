import { describe, expect, it } from "vitest";

import {
  parseCitations,
  verifyCitations,
  splitSentences,
  sentenceCoverage,
  costUsd,
  toolCallTally,
  guardrailUsage,
} from "@/features/evaluation/metrics";
import type { EvidenceEntry } from "@/features/evaluation/run-manifest";

const evidence: EvidenceEntry[] = [
  { kind: "chunk", id: "a-d-manual-0", ordinal: 0 },
  { kind: "chunk", id: "a-d-manual-2", ordinal: 2 },
  { kind: "fault", id: "f-51" },
  { kind: "guardrail", mode: "HDF" },
];

describe("parseCitations", () => {
  it("parses chunk, fault and guardrail citations", () => {
    const c = parseCitations("Said [chunk:a-d-manual-0#0] and [fault:f-51] but not [guardrail:HDF].");
    expect(c).toHaveLength(3);
    expect(c[0]).toMatchObject({ kind: "chunk", id: "a-d-manual-0", ordinal: 0 });
    expect(c[1]).toMatchObject({ kind: "fault", id: "f-51" });
    expect(c[2]).toMatchObject({ kind: "guardrail", mode: "HDF" });
  });

  it("treats a missing ordinal as null rather than dropping the citation", () => {
    const c = parseCitations("[chunk:a-d-manual-0]");
    expect(c[0]).toMatchObject({ kind: "chunk", id: "a-d-manual-0", ordinal: null });
  });

  it("ignores square brackets that are not citations", () => {
    const c = parseCitations("claim [bracketed] text");
    expect(c).toHaveLength(0);
  });
});

describe("verifyCitations", () => {
  it("accepts citations that exist in the turn's evidence and match the ordinal", () => {
    const c = parseCitations("heat [chunk:a-d-manual-0#0] plus [fault:f-51] and [guardrail:HDF] verified");
    const r = verifyCitations(c, evidence);
    expect(r.invalid).toHaveLength(0);
    expect(r.validity).toBe(1);
  });

  it("rejects a wrong ordinal, a missing id, and a mode not checked", () => {
    const c = parseCitations("[chunk:a-d-manual-0#3] [fault:f-999] [guardrail:PWF]");
    const r = verifyCitations(c, evidence);
    expect(r.valid).toHaveLength(0);
    expect(r.invalid).toHaveLength(3);
    expect(r.validity).toBe(0);
  });

  it("reports validity 1 when nothing was cited (coverage reports that)", () => {
    expect(verifyCitations([], evidence).validity).toBe(1);
  });
});

describe("splitSentences and sentenceCoverage", () => {
  it("splits on sentence boundaries while keeping citations attached", () => {
    const s = splitSentences("Pwf fires. See [fault:f-51]. Power is low.");
    expect(s).toEqual(["Pwf fires.", "See [fault:f-51].", "Power is low."]);
  });

  it("counts only sentences carrying a valid citation", () => {
    const sentences = splitSentences("Ground [chunk:a-d-manual-2#2]. Ungrounded guess. [fault:f-51] also.");
    const r = sentenceCoverage(sentences, parseCitations("Ground [chunk:a-d-manual-2#2]. Ungrounded guest. [fault:f-51] also."));
    expect(r.total).toBe(3);
    expect(r.covered).toBe(2);
    expect(r.coverage).toBeCloseTo(2 / 3);
  });
});

describe("costUsd", () => {
  it("computes USD from the frozen price table", () => {
    const cost = costUsd({ promptTokens: 1_000_000, completionTokens: 1_000_000 });
    expect(cost).toBeCloseTo(0.75); // 0.15 + 0.60
  });
});

describe("toolCallTally", () => {
  it("groups outcomes by code", () => {
    const t = toolCallTally([
      { name: "checkGuardrails", outcome: "SUCCESS" },
      { name: "checkGuardrails", outcome: "SUCCESS" },
      { name: "getFaultHistory", outcome: "NOT_FOUND" },
    ]);
    expect(t.total).toBe(3);
    expect(t.successRate).toBeCloseTo(2 / 3);
    expect(t.byTool.checkGuardrails.SUCCESS).toBe(2);
    expect(t.counts.NOT_FOUND).toBe(1);
  });

  it("rates nothing called as 1 (no failures to score)", () => {
    expect(toolCallTally([]).successRate).toBe(1);
  });
});

describe("guardrailUsage", () => {
  it("reports whether checkGuardrails was called and which modes were claimed", () => {
    const usage = guardrailUsage(
      [{ name: "checkGuardrails", outcome: "SUCCESS" }],
      parseCitations("HDF [guardrail:HDF]"),
    );
    expect(usage.called).toBe(true);
    expect(usage.modeClaims).toEqual(["HDF"]);
  });

  it("reports no claim when the guardrail tool answered clean", () => {
    const usage = guardrailUsage(
      [{ name: "checkGuardrails", outcome: "SUCCESS" }],
      parseCitations("Reading is clean"),
    );
    expect(usage.called).toBe(true);
    expect(usage.modeClaims).toEqual([]);
  });
});