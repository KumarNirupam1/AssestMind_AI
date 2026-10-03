import { TOOL_NAMES_FROZEN, type ToolNameFrozen } from "@/features/evaluation/question-set.ts";
import { TOOL_OUTCOME_CODES, type ToolOutcomeCode } from "@/features/evaluation/run-manifest.ts";

/**
 * The tool contract shared by the Phase 4 registry, the Phase 5 UI and the
 * Phase 6B harness.
 *
 * `ToolName` is deliberately derived from the FROZEN list
 * (`features/evaluation/question-set.ts`), never re-declared here. If the two
 * ever disagree, the compiler fails instead of the demo and the experiment
 * silently drifting apart — the property architecture §3.4 exists for.
 */
export type ToolName = ToolNameFrozen;

export { TOOL_NAMES_FROZEN };

/**
 * Outcome codes are the FROZEN Phase 6A taxonomy
 * (`features/evaluation/run-manifest.ts`), minus its `SUCCESS` member. A tool
 * that succeeds is `SUCCESS`; every failure must name one of these four.
 */
export type ToolErrorCode = Exclude<ToolOutcomeCode, "SUCCESS">;

export const TOOL_ERROR_CODES = TOOL_OUTCOME_CODES.filter(
  (c): c is ToolErrorCode => c !== "SUCCESS",
);

/**
 * `ToolOutcome<T>` (architecture §3.3): tools return { ok: true, data } or
 * { ok: false, error: { code, message } }. They never throw — a throw kills
 * the stream and teaches the model nothing; an `ok: false` outcome lets the
 * model see the failure and adapt its answer.
 */
export type ToolOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ToolErrorCode; message: string } };

/** Construct `ok: true`. */
export const ok = <T>(data: T): ToolOutcome<T> => ({ ok: true, data });

/** Construct `ok: false` with a typed error code. */
export function fail<T>(code: ToolErrorCode, message: string): ToolOutcome<T> {
  return { ok: false, error: { code, message } };
}

/** Map back to the run-manifest taxonomy a `ToolCallEntry` records. */
export function outcomeCode(outcome: ToolOutcome<unknown>): ToolOutcomeCode {
  return outcome.ok ? "SUCCESS" : outcome.error.code;
}