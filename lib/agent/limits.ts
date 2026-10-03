import { fail, type ToolOutcome } from "./types.ts";

/**
 * Per-turn resource limits (architecture §3.3). These are the load-bearing
 * production bounds; the FROZEN *protocol* parameters (model, temperature,
 * configs) live in `features/evaluation/question-set.ts` and Phase 4 must not
 * tune those. Nothing here is part of the evaluation.
 */

/** Step ceiling. v7: `stopWhen: isStepCount(STEP_CEILING)`. */
export const STEP_CEILING = 5;

/**
 * Cap on generated tokens for a whole turn (all steps combined). Bounded so a
 * confused multi-step loop cannot run a huge completion; generous enough that
 * tool calls + the final answer fit.
 */
export const MAX_TURN_OUTPUT_TOKENS = 8192;

/**
 * Max tokens this turn may consume from the per-user daily quota. Charged at
 * request start, so a denied request never reaches the model.
 */
export const TURN_TOKEN_BUDGET = 40_000;

/** Per-user daily token quota, enforced server-side before the model runs. */
export const DAILY_TOKEN_BUDGET = 400_000;

/** Per-tool wall-clock limit; a tool exceeding it is retried once, then
 * degrades to `ok: false, code: TIMEOUT`. */
export const TOOL_TIMEOUT_MS = 5_000;

/** Total evidence entries a single turn may log (context-window budget). */
export const MAX_EVIDENCE_ENTRIES_PER_TURN = 40;

// ---------------------------------------------------------------------------
// Per-tool result caps. Cap 5 rather than 25: six tools returning k results
// each will overflow the context window on a broad question. This is a
// documented experimental confound (config 5 carries more context than
// config 1) — the report must state it, not hide it.
// ---------------------------------------------------------------------------

/** Chunk text length shown to the model and returned by retrieval tools. A
 * full chunk stays in the database; the answer must not reproduce it whole. */
export const CHUNK_DISPLAY_CHARS = 800;

export const SEARCH_TOOL_DEFAULT_TOP_K = 5;
export const SEARCH_TOOL_MAX_TOP_K = 10;

export const FAULT_HISTORY_DEFAULT_LIMIT = 12;
export const FAULT_HISTORY_MAX_LIMIT = 25;

export const MAINTENANCE_DEFAULT_LIMIT = 12;
export const MAINTENANCE_MAX_LIMIT = 25;

/** Open faults surfaced by getAssetContext so "current state" is citable. */
export const ASSET_CONTEXT_OPEN_FAULT_CAP = 5;

// ---------------------------------------------------------------------------
// Timeout + single-retry executor
// ---------------------------------------------------------------------------

const TIMEOUT_SENTINEL = Symbol("tool-timeout");

type AttemptResult<T> =
  | { status: "resolved"; outcome: ToolOutcome<T> }
  | { status: "timeout" };

async function runAttempt<T>(
  execute: () => Promise<ToolOutcome<T>>,
  timeoutMs: number,
): Promise<AttemptResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const outcome = await Promise.race([
      execute(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(TIMEOUT_SENTINEL), timeoutMs);
      }),
    ]);
    return { status: "resolved", outcome };
  } catch (err) {
    if (err === TIMEOUT_SENTINEL) return { status: "timeout" };
    // A tool is required never to throw, but "required" is not a substitute
    // for a guard: convert an unexpected exception into an UPSTREAM outcome so
    // the stream survives even when a tool misbehaves.
    const message = err instanceof Error ? err.message : String(err);
    return { status: "resolved", outcome: fail("UPSTREAM", `Unexpected tool error: ${message}`) };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Run a tool `execute` with a per-tool timeout and a single retry before
 * degrading to `ok: false, code: TIMEOUT` (architecture §3.3).
 *
 * Retrying a *tool that already returned* would double a data-emitting call,
 * so only a timeout (the attempt never resolved) triggers the retry. A tool
 * that returns `ok: false` is passed through unchanged — that is the model's
 * information, not a fault.
 */
export async function runWithTimeoutAndRetry<T>(
  execute: () => Promise<ToolOutcome<T>>,
  timeoutMs = TOOL_TIMEOUT_MS,
): Promise<ToolOutcome<T>> {
  const first = await runAttempt(execute, timeoutMs);
  if (first.status === "resolved") return first.outcome;

  const second = await runAttempt(execute, timeoutMs);
  if (second.status === "resolved") return second.outcome;

  return fail<T>(
    "TIMEOUT",
    `Tool did not respond within ${timeoutMs} ms on either attempt`,
  );
}

/** Bound a user-supplied result count to the per-tool cap. */
export function clampCount(requested: number | undefined, fallback: number, max: number): number {
  if (requested === undefined || !Number.isFinite(requested) || requested < 1) return fallback;
  return Math.min(Math.floor(requested), max);
}

/** A helper overloaded `ok` re-export so callers keep imports to one module. */
export { ok } from "./types.ts";