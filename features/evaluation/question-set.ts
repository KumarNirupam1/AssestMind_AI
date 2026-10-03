import { z } from "zod";

import { GuardrailModeSchema } from "../guardrails/rules.ts";

// The evaluation question set and the RQ1-RQ5 metrics are FROZEN at commit
// time (docs/evaluation-protocol.md). Changing anything in this file after
// Phase 6A is committed requires a new ADR, per the protocol. These are the
// names and values the Phase 4 tool registry and the Phase 6B harness read,
// so the demo and the experiment cannot drift.

// ---------------------------------------------------------------------------
// Frozen switches
// ---------------------------------------------------------------------------

/** Model pinned by the frozen protocol. */
export const EVAL_MODEL = "gpt-4o-mini";

/** Sampling temperature. 0 makes repeats measure environmental variance. */
export const EVAL_TEMPERATURE = 0;
export const EVAL_TEMPERATURE_IS_ZERO = EVAL_TEMPERATURE === 0;

/** Runs per question per config. 24 questions x 5 configs x 3 = 360 runs. */
export const EVAL_REPEATS_PER_CONFIG = 3;

/** Cost table RQ4 is computed from, as of the protocol freeze. */
export const EVAL_PRICING = {
  inputPerMTok: 0.15,
  outputPerMTok: 0.6,
  currency: "USD",
  asOf: "2026-09-28",
} as const;

// ---------------------------------------------------------------------------
// The five frozen tool-subset configs
//
// Configs are subsets of the ONE registry, never five code paths
// (architecture §3.4). `lib/agent` Phase 4 must build
// buildToolRegistry from exactly these names.
// ---------------------------------------------------------------------------

export const TOOL_NAMES_FROZEN = [
  "searchDocumentsVector",
  "searchDocumentsKeyword",
  "getAssetContext",
  "getFaultHistory",
  "getMaintenanceHistory",
  "checkGuardrails",
] as const;

export type ToolNameFrozen = (typeof TOOL_NAMES_FROZEN)[number];

export const TOOL_CONFIGS_FROZEN = {
  1: [],
  2: [TOOL_NAMES_FROZEN[0]],
  3: [TOOL_NAMES_FROZEN[0], TOOL_NAMES_FROZEN[1]],
  4: [
    TOOL_NAMES_FROZEN[0],
    TOOL_NAMES_FROZEN[1],
    TOOL_NAMES_FROZEN[2],
    TOOL_NAMES_FROZEN[3],
    TOOL_NAMES_FROZEN[4],
  ],
  5: [...TOOL_NAMES_FROZEN],
} as const satisfies Record<number, readonly ToolNameFrozen[]>;

export const TOOL_CONFIG_KEYS = [1, 2, 3, 4, 5] as const;
export type ToolConfigKey = (typeof TOOL_CONFIG_KEYS)[number];

// ---------------------------------------------------------------------------
// Question set schema
// ---------------------------------------------------------------------------

/** All five AI4I modes, for classifying questions (incl. the irreducibly
 * random TWF/RNF "weak signal" cases). */
export const DATASET_MODE_SCHEMA = z.enum(["HDF", "PWF", "OSF", "TWF", "RNF"]);
export type DatasetMode = z.infer<typeof DATASET_MODE_SCHEMA>;

export const QUESTION_KIND_SCHEMA = z.enum([
  "RETRIEVAL", // answerable from document text alone
  "STRUCTURED", // answerable from fault/maintenance/asset records
  "GUARDRAIL", // needs checkGuardrails on a concrete reading
  "MIXED", // needs both retrieval and structured tools
  "WEAK_SIGNAL", // TWF/RNF: no tool can determine the mode
  "ABSTENTION", // not answerable from the corpus at all
]);
export type QuestionKind = z.infer<typeof QUESTION_KIND_SCHEMA>;

export const GOLD_SCHEMA = z.object({
  /** Expected document evidence as `ASSETNAME/docType` (ordinal-agnostic). */
  docs: z.array(z.string()),
  /** Expected fault-record evidence as `f-<udi>`. */
  faults: z.array(z.string()),
  /** Guardrail expectation. modes refer to the deterministic three only. */
  guardrail: z
    .object({
      relevant: z.boolean(),
      modes: z.array(GuardrailModeSchema),
      expected: z
        .string()
        .describe("what a grounded answer should conclude from the reading"),
    })
    .nullable(),
});

export const EVALUATION_QUESTION_SCHEMA = z.object({
  id: z.string().regex(/^q\d{3}$/),
  query: z.string().min(1),
  kind: QUESTION_KIND_SCHEMA,
  requiresTools: z.array(z.enum(TOOL_NAMES_FROZEN)),
  gold: GOLD_SCHEMA,
  rationale: z.string().describe("which RQ the question serves and why"),
});

export type EvaluationQuestion = z.infer<typeof EVALUATION_QUESTION_SCHEMA>;

export const LABELLED_QUESTION_SET_SCHEMA = z.object({
  schemaVersion: z.literal("v1"),
  frozenAt: z.string().describe("ISO date"),
  model: z.literal(EVAL_MODEL),
  temperature: z.literal(EVAL_TEMPERATURE),
  repeatsPerConfig: z.literal(EVAL_REPEATS_PER_CONFIG),
  questions: z.array(EVALUATION_QUESTION_SCHEMA),
});

export type LabelledQuestionSet = z.infer<typeof LABELLED_QUESTION_SET_SCHEMA>;

export function parseQuestionSet(raw: unknown): LabelledQuestionSet {
  return LABELLED_QUESTION_SET_SCHEMA.parse(raw);
}