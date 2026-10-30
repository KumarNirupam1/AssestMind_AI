import {
  TOOL_CONFIGS_FROZEN,
  TOOL_CONFIG_KEYS,
  type ToolConfigKey,
} from "@/features/evaluation/question-set.ts";

/**
 * UI-facing labels for the FROZEN eval configs (Phase 6A). The selector is a
 * demo control, so these are display strings only — the empty/vector/…/full
 * membership itself stays in `TOOL_CONFIGS_FROZEN` and is never re-declared.
 */
export const CONFIG_LABELS: Record<ToolConfigKey, string> = {
  1: "No retrieval (baseline)",
  2: "Vector RAG",
  3: "Hybrid RAG (vector + keyword)",
  4: "Hybrid + structured data",
  5: "Full agent (+ guardrails)",
};

/**
 * One-line explanation of what each frozen config actually registers. Shown
 * beside the selector so "which RAG mode am I in" is answerable without
 * reading the source. Membership still comes from `TOOL_CONFIGS_FROZEN`.
 */
export const CONFIG_DESCRIPTIONS: Record<ToolConfigKey, string> = {
  1: "No tools registered — the model answers from parametric knowledge only. This is the control baseline for the evaluation.",
  2: "Dense embedding search over document chunks using pgvector cosine similarity.",
  3: "Vector search plus Postgres full-text keyword search; the agent fuses both result sets.",
  4: "Adds asset context, fault history, and maintenance history on top of hybrid retrieval. Guardrails are not available.",
  5: "Every tool: hybrid document retrieval, structured asset history, and the deterministic AI4I guardrail rules.",
};

export const CONFIG_OPTIONS: ToolConfigKey[] = [...TOOL_CONFIG_KEYS];

export function configToolCount(config: ToolConfigKey): number {
  return TOOL_CONFIGS_FROZEN[config].length;
}

export function isToolConfigKey(value: unknown): value is ToolConfigKey {
  return typeof value === "number" && TOOL_CONFIG_KEYS.includes(value as ToolConfigKey);
}