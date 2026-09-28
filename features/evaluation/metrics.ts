import type { GuardrailMode } from "../guardrails/rules.ts";
import type {
  EvidenceEntry,
  ToolCallEntry,
  ToolOutcomeCode,
  Usage,
} from "./run-manifest.ts";
import { EVAL_PRICING } from "./question-set.ts";

// Pure metric functions for RQ1-RQ5. Defined and FROZEN with Phase 6A so the
// numbers mean the same thing across every run; the protocol document states
// each formula and the values here implement it.

// ---------------------------------------------------------------------------
// Citations (RQ1 grounding boilerplate + RQ5 input)
//
// Format from architecture §3.3: [chunk:<id>#<n>], [fault:<id>],
// [guardrail:<mode>].
// ---------------------------------------------------------------------------

export type Citation =
  | { kind: "chunk"; id: string; ordinal: number | null; raw: string }
  | { kind: "fault"; id: string; raw: string }
  | { kind: "guardrail"; mode: GuardrailMode; raw: string };

const CITATION_RE = /\[(chunk|fault|guardrail):([^\]\#]*)(?:#(\d+))?\]/g;

export function parseCitations(answer: string): Citation[] {
  const out: Citation[] = [];
  for (const m of answer.matchAll(CITATION_RE)) {
    const kind = m[1] as "chunk" | "fault" | "guardrail";
    const idText = m[2];
    const ordinalText = m[3];
    if (kind === "chunk") {
      out.push({
        kind,
        id: idText,
        ordinal: ordinalText === undefined ? null : Number(ordinalText),
        raw: m[0],
      });
    } else if (kind === "fault") {
      out.push({ kind, id: idText, raw: m[0] });
    } else {
      out.push({ kind, mode: idText as GuardrailMode, raw: m[0] });
    }
  }
  return out;
}

/** The shape a citation must match for the evidence it points at. */
export interface CitationReport {
  citations: Citation[];
  valid: Citation[];
  invalid: Citation[];
  /** valid / (valid + invalid); 1 when nothing was cited (coverage reports that). */
  validity: number;
}

export function verifyCitations(citations: Citation[], evidence: EvidenceEntry[]): CitationReport {
  const chunkById = new Map<string, EvidenceEntry & { kind: "chunk" }>();
  const faultIds = new Set<string>();
  const guardrailModes = new Set<GuardrailMode>();
  for (const e of evidence) {
    if (e.kind === "chunk") chunkById.set(e.id, e);
    else if (e.kind === "fault") faultIds.add(e.id);
    else guardrailModes.add(e.mode);
  }

  const valid: Citation[] = [];
  const invalid: Citation[] = [];
  for (const c of citations) {
    if (c.kind === "chunk") {
      const match = chunkById.get(c.id);
      if (match && (c.ordinal === null || c.ordinal === match.ordinal)) valid.push(c);
      else invalid.push(c);
    } else if (c.kind === "fault") {
      if (faultIds.has(c.id)) valid.push(c);
      else invalid.push(c);
    } else {
      if (guardrailModes.has(c.mode)) valid.push(c);
      else invalid.push(c);
    }
  }

  return {
    citations,
    valid,
    invalid,
    validity: citations.length === 0 ? 1 : valid.length / citations.length,
  };
}

// ---------------------------------------------------------------------------
// Sentence-level citation coverage (RQ1 groundedness)
//
// The mechanical groundedness proxy: the share of answer sentences carrying at
// least one citation that resolves against the turn's evidence. From beyond
// the protocol, uncited factual sentences are caught by the reviewed sample.
// ---------------------------------------------------------------------------

const SENTENCE_SPLIT_RE = /(?<=[.!?])\s+(?=[A-Z0-9\[])/;

export function splitSentences(text: string): string[] {
  return text
    .trim()
    .split(SENTENCE_SPLIT_RE)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface CoverageReport {
  sentences: string[];
  covered: number;
  total: number;
  /** covered / total; 0 when there are no sentences. */
  coverage: number;
}

export function sentenceCoverage(
  sentences: string[],
  validCitations: Citation[],
): CoverageReport {
  const validRaw = new Set(validCitations.map((c) => c.raw));
  const covered = sentences.filter((s) => sentenceHasAny(validRaw, s)).length;
  return {
    sentences,
    covered,
    total: sentences.length,
    coverage: sentences.length === 0 ? 0 : covered / sentences.length,
  };
}

function sentenceHasAny(validRaw: Set<string>, sentence: string): boolean {
  for (const match of sentence.matchAll(CITATION_RE)) {
    if (validRaw.has(match[0])) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// RQ4 cost from token usage
//
// ai v7: top-level `usage` is all steps; `finalStep.usage` is the final step.
// RQ4 reports both. costUsd uses the frozen pricing table.
// ---------------------------------------------------------------------------

export function costUsd(usage: Pick<Usage, "promptTokens" | "completionTokens">): number {
  const { inputPerMTok, outputPerMTok } = EVAL_PRICING;
  return (
    (usage.promptTokens / 1_000_000) * inputPerMTok +
    (usage.completionTokens / 1_000_000) * outputPerMTok
  );
}

// ---------------------------------------------------------------------------
// RQ3 tool-call success/failure taxonomy + guardrail usage
// ---------------------------------------------------------------------------

export interface ToolTally {
  byTool: Record<string, Partial<Record<ToolOutcomeCode, number>>>;
  counts: Record<ToolOutcomeCode, number>;
  total: number;
  successRate: number; // SUCCESS / total; 1 when nothing was called
}

export function toolCallTally(toolCalls: ToolCallEntry[]): ToolTally {
  const byTool: ToolTally["byTool"] = {};
  const counts: ToolTally["counts"] = { SUCCESS: 0, NOT_FOUND: 0, INVALID_INPUT: 0, TIMEOUT: 0, UPSTREAM: 0 };
  for (const call of toolCalls) {
    byTool[call.name] = byTool[call.name] ?? {};
    byTool[call.name][call.outcome] = (byTool[call.name][call.outcome] ?? 0) + 1;
    counts[call.outcome] += 1;
  }
  return {
    byTool,
    counts,
    total: toolCalls.length,
    successRate: toolCalls.length === 0 ? 1 : counts.SUCCESS / toolCalls.length,
  };
}

export interface GuardrailUsage {
  called: boolean;
  modeClaims: GuardrailMode[]; // modes the answer asserts via [guardrail:...]
}

export function guardrailUsage(
  toolCalls: ToolCallEntry[],
  citations: Citation[],
): GuardrailUsage {
  const called = toolCalls.some((c) => c.name === "checkGuardrails");
  const modeClaims = citations
    .filter((c): c is Extract<Citation, { kind: "guardrail" }> => c.kind === "guardrail")
    .map((c) => c.mode);
  return { called, modeClaims };
}