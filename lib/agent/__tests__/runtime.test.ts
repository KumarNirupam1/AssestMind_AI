import { describe, expect, it } from "vitest";

import { MAX_EVIDENCE_ENTRIES_PER_TURN } from "@/lib/agent/limits";
import { createTurnCollectors } from "@/lib/agent/runtime";

describe("createTurnCollectors", () => {
  it("appends tool-call records in order", () => {
    const c = createTurnCollectors();
    c.recordToolCall({ name: "getAssetContext", outcome: "SUCCESS", durationMs: 10 });
    c.recordToolCall({ name: "checkGuardrails", outcome: "NOT_FOUND", durationMs: 4 });
    expect(c.toolCalls).toHaveLength(2);
    expect(c.toolCalls[1]).toMatchObject({ outcome: "NOT_FOUND" });
  });

  it("de-duplicates evidence by id/mode", () => {
    const c = createTurnCollectors();
    c.recordEvidence([
      { kind: "chunk", id: "c-1", ordinal: 0 },
      { kind: "chunk", id: "c-1", ordinal: 0 },
      { kind: "fault", id: "f-1" },
      { kind: "fault", id: "f-1" },
      { kind: "guardrail", mode: "HDF" },
      { kind: "guardrail", mode: "HDF" },
    ]);
    expect(c.evidence).toEqual([
      { kind: "chunk", id: "c-1", ordinal: 0 },
      { kind: "fault", id: "f-1" },
      { kind: "guardrail", mode: "HDF" },
    ]);
  });

  it("treats the same chunk at different ordinals as distinct", () => {
    const c = createTurnCollectors();
    c.recordEvidence([
      { kind: "chunk", id: "c-1", ordinal: 0 },
      { kind: "chunk", id: "c-1", ordinal: 1 },
    ]);
    expect(c.evidence).toHaveLength(2);
  });

  it("caps evidence at the per-turn budget, stopping at the boundary", () => {
    const c = createTurnCollectors();
    let pushed = 0;
    while (pushed < MAX_EVIDENCE_ENTRIES_PER_TURN + 25) {
      c.recordEvidence([{ kind: "fault", id: `f-${pushed}` }]);
      pushed += 1;
    }
    expect(c.evidence).toHaveLength(MAX_EVIDENCE_ENTRIES_PER_TURN);
  });
});