import type { Tool, ToolSet } from "ai";

import { TOOL_NAMES_FROZEN } from "@/features/evaluation/question-set.ts";
import type { ToolRuntime } from "./runtime.ts";
import type { ToolName } from "./types.ts";
import { defineGetAssetContextTool } from "./tools/asset-context.ts";
import { defineCheckGuardrailsTool } from "./tools/guardrails.ts";
import { defineGetFaultHistoryTool, defineGetMaintenanceHistoryTool } from "./tools/history.ts";
import { defineSearchDocumentsKeywordTool, defineSearchDocumentsVectorTool } from "./tools/retrieval.ts";

/**
 * buildToolRegistry — the single entry point for the one registry,
 * parameterised by tool subset (architecture §3.4).
 *
 * Configs 1-5 are subsets of this one object, selected by name from the
 * FROZEN config table in `features/evaluation/question-set.ts`. The chat route
 * (Phase 4), the UI config selector (Phase 5) and the evaluation harness
 * (Phase 6B) all call this same function, so the demo and the experiment can
 * never drift — there is exactly one code path per tool.
 */
export function buildToolRegistry(
  names: readonly ToolName[],
  runtime: ToolRuntime,
): ToolSet {
  const seen = new Set<string>();
  const tools: Record<string, Tool> = {};

  for (const name of names) {
    if (!TOOL_NAMES_FROZEN.includes(name)) {
      throw new Error(`Unknown tool "${name}" is not in the FROZEN registry.`);
    }
    if (seen.has(name)) continue;
    seen.add(name);

    const factory = TOOL_FACTORIES[name];
    if (!factory) {
      throw new Error(`No implementation registered for tool "${name}".`);
    }
    tools[name] = factory(runtime);
  }

  return tools;
}

export const TOOL_FACTORIES: Record<ToolName, (runtime: ToolRuntime) => Tool> = {
  searchDocumentsVector: defineSearchDocumentsVectorTool,
  searchDocumentsKeyword: defineSearchDocumentsKeywordTool,
  getAssetContext: defineGetAssetContextTool,
  getFaultHistory: defineGetFaultHistoryTool,
  getMaintenanceHistory: defineGetMaintenanceHistoryTool,
  checkGuardrails: defineCheckGuardrailsTool,
};