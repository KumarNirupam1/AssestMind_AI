import type { ToolExecutionOptions } from "ai";

import { runWithTimeoutAndRetry, TOOL_TIMEOUT_MS } from "./limits.ts";
import type { ToolRuntime } from "./runtime.ts";
import { outcomeCode, type ToolName, type ToolOutcome } from "./types.ts";

/**
 * The shared envelope around every tool `execute`:
 *
 * 1. run with a per-tool timeout and a single retry, degrading to
 *    `ok: false, code: TIMEOUT` and never throwing (limits.ts);
 * 2. record the call in the FROZEN taxonomy (`{name, outcome, durationMs}`)
 *    for the evidence trail and the Phase 6B run manifest.
 *
 * Tools define `execute: withToolBoundary("name", runtime, async (input) => {...})`.
 * Type inference flows through, so a tool's `input` stays typed.
 */
export function withToolBoundary<TInput, TOutput>(
  name: ToolName,
  runtime: ToolRuntime,
  execute: (input: TInput, options: ToolExecutionOptions<Record<string, unknown>>) => Promise<ToolOutcome<TOutput>>,
): (input: TInput, options: ToolExecutionOptions<Record<string, unknown>>) => Promise<ToolOutcome<TOutput>> {
  const timeoutMs = runtime.timeoutMs ?? TOOL_TIMEOUT_MS;

  return async (input, options) => {
    const started = Date.now();
    const outcome = await runWithTimeoutAndRetry(() => execute(input, options), timeoutMs);
    runtime.recordToolCall({
      name,
      outcome: outcomeCode(outcome),
      durationMs: Date.now() - started,
    });
    return outcome;
  };
}