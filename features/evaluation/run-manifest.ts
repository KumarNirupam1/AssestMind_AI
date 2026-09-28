import { z } from "zod";

import { GuardrailModeSchema } from "../guardrails/rules.ts";
import { TOOL_NAMES_FROZEN } from "./question-set.ts";

// Shape of one evaluation run, validated on read (architecture §3A: the
// evidence blob is the eval parser's input and its first change breaks old
// data loudly). Both the Phase 6B harness that writes these and the
// citation verifier that reads them go through this schema.

export const TOOL_OUTCOME_CODES = [
  "SUCCESS",
  "NOT_FOUND",
  "INVALID_INPUT",
  "TIMEOUT",
  "UPSTREAM",
] as const;
export type ToolOutcomeCode = (typeof TOOL_OUTCOME_CODES)[number];

export const TOOL_CALL_ENTRY_SCHEMA = z.object({
  name: z.enum(TOOL_NAMES_FROZEN),
  outcome: z.enum(TOOL_OUTCOME_CODES),
  durationMs: z.number().nonnegative().optional(),
});
export type ToolCallEntry = z.infer<typeof TOOL_CALL_ENTRY_SCHEMA>;

export const EVIDENCE_ENTRY_SCHEMA = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("chunk"), id: z.string().min(1), ordinal: z.number().int().nonnegative() }),
  z.object({ kind: z.literal("fault"), id: z.string().min(1) }),
  z.object({ kind: z.literal("guardrail"), mode: GuardrailModeSchema }),
]);
export type EvidenceEntry = z.infer<typeof EVIDENCE_ENTRY_SCHEMA>;

export const USAGE_SCHEMA = z.object({
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
});
export type Usage = z.infer<typeof USAGE_SCHEMA>;

export const EVAL_RUN_SCHEMA = z.object({
  runId: z.string().min(1),
  questionId: z.string().regex(/^q\d{3}$/),
  config: z.number().int().min(1).max(5),
  systemPromptVersion: z.string().min(1),
  gitSha: z.string().min(7),
  startedAt: z.string(),
  durationMs: z.number().nonnegative(),
  /** All steps. */
  usage: USAGE_SCHEMA,
  /** Final step only - logged separately because AI SDK v7 changed the
   * meaning of the top-level usage after the migration (see AGENTS.md). */
  finalStepUsage: USAGE_SCHEMA.nullable(),
  toolCalls: z.array(TOOL_CALL_ENTRY_SCHEMA),
  evidence: z.array(EVIDENCE_ENTRY_SCHEMA),
  answer: z.string(),
});
export type EvalRun = z.infer<typeof EVAL_RUN_SCHEMA>;

export const EVAL_RUNS_MANIFEST_SCHEMA = z.object({
  schemaVersion: z.literal("v1"),
  generatedAt: z.string(),
  runs: z.array(EVAL_RUN_SCHEMA),
});
export type EvalRunsManifest = z.infer<typeof EVAL_RUNS_MANIFEST_SCHEMA>;

export function parseRunManifest(raw: unknown): EvalRunsManifest {
  return EVAL_RUNS_MANIFEST_SCHEMA.parse(raw);
}