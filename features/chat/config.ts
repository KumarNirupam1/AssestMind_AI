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
  1: "Baseline — no tools",
  2: "Vector search only",
  3: "Vector + keyword search",
  4: "Structured data (no guardrails)",
  5: "Full toolset (all six)",
};

export const CONFIG_OPTIONS: ToolConfigKey[] = [...TOOL_CONFIG_KEYS];

export function configToolCount(config: ToolConfigKey): number {
  return TOOL_CONFIGS_FROZEN[config].length;
}

export function isToolConfigKey(value: unknown): value is ToolConfigKey {
  return typeof value === "number" && TOOL_CONFIG_KEYS.includes(value as ToolConfigKey);
}