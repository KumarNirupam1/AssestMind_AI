import { describe, expect, it } from "vitest";

import { splitCitations } from "@/features/chat/citations";

describe("splitCitations", () => {
  it("extracts the three machine-checkable citation kinds", () => {
    const segments = splitCitations(
      "Root cause is thermal stress [chunk:clx1ab#3], tied to [fault:F042] and [guardrail:HDF].",
    );
    expect(segments.filter((s) => s.type === "citation").map((s) => s.raw)).toEqual([
      "chunk:clx1ab#3",
      "fault:F042",
      "guardrail:HDF",
    ]);
  });

  it("parses kind and value for each citation kind", () => {
    const citations = splitCitations("[chunk:chunk_9#12] [fault:F1X] [guardrail:OSF]").filter(
      (s) => s.type === "citation",
    );
    expect(citations).toEqual([
      { type: "citation", token: { kind: "chunk", value: "chunk_9#12" }, raw: "chunk:chunk_9#12" },
      { type: "citation", token: { kind: "fault", value: "F1X" }, raw: "fault:F1X" },
      { type: "citation", token: { kind: "guardrail", value: "OSF" }, raw: "guardrail:OSF" },
    ]);
  });

  it("preserves surrounding text and interleaves segments in order", () => {
    const segments = splitCitations("A [chunk:c#1] B [fault:f] C");
    expect(segments.map((s) => (s.type === "text" ? s.text : s.raw))).toEqual([
      "A ",
      "chunk:c#1",
      " B ",
      "fault:f",
      " C",
    ]);
  });

  it("rejects malformed citations (no partial matches)", () => {
    const segments = splitCitations(
      "[chunk:c] [chunk:c#] [fault:] [guardrail:XX] [chunk:ab#12x] plain [guardrail:hdF]",
    );
    expect(segments.every((s) => s.type === "text")).toBe(true);
  });

  it("handles empty and citation-free text", () => {
    expect(splitCitations("")).toEqual([]);
    expect(splitCitations("no citations here")).toEqual([{ type: "text", text: "no citations here" }]);
  });
});