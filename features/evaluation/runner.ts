import type { Usage } from "./run-manifest.ts";

// Pure helpers shared by the Phase 6B run engine (`scripts/run-eval.ts`).
// They live here (not in the script) so they are unit-testable and so the
// script stays a thin orchestration shell. Nothing here is part of the frozen
// protocol content; the run shape itself is still `EVAL_RUN_SCHEMA`.

/**
 * Every run of the 24x5x3 grid gets a deterministic id: question, config,
 * repeat. Repetition is ordinal within (question, config), so the id is
 * stable across re-runs and `--resume` can skip what already completed.
 */
export function buildRunId(questionId: string, config: number, repeat: number): string {
  return `${questionId}-c${config}-r${repeat}`;
}

/**
 * Map the AI SDK v7 `LanguageModelUsage` (all fields optional, `inputTokens` /
 * `outputTokens` naming) onto the frozen `USAGE_SCHEMA` (`promptTokens` /
 * `completionTokens` fields). `totalTokens` is a derived convenience when the
 * provider omits it; the two token counts are never guessed.
 */
export function usageToSchema(usage: {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}): Usage {
  const promptTokens = usage.inputTokens ?? 0;
  const completionTokens = usage.outputTokens ?? 0;
  const totalTokens = usage.totalTokens ?? promptTokens + completionTokens;
  return { promptTokens, completionTokens, totalTokens };
}