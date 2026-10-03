import { tool, zodSchema } from "ai";
import { z } from "zod";

import { AI4I_THRESHOLDS, evaluateGuardrails, type ProcessSample } from "@/features/guardrails/rules.ts";
import { withToolBoundary } from "../boundary.ts";
import type { ToolRuntime } from "../runtime.ts";
import { fail, ok } from "../types.ts";

/**
 * checkGuardrails — the deterministic AI4I rule set, not a trained model.
 *
 * The tool looks up ONE concrete stored reading of an asset (by its UDI row
 * id, or by timestamp — resolving to the reading at-or-before the time), then
 * evaluates the verified HDF/PWF/OSF rules against the stored process values.
 * The dataset's own label columns are never read: the rule engine is
 * validated against them in Phase 2, and the agent must not quietly choose
 * them as the source of truth.
 *
 * Every mode that fires is recorded as `guardrail` evidence, so an answer
 * like "PWF fires ([guardrail:PWF])" is machine-verifiable. TWF and RNF are
 * not threshold rules and can never be reported here.
 */

const guardrailInput = zodSchema(z
  .object({
    assetName: z.string().min(1).describe('Asset name, e.g. "PUMP-101".'),
    udi: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("The dataset row id (UDI) of the exact reading to evaluate."),
    at: z
      .string()
      .datetime({ offset: true })
      .optional()
      .describe("ISO-8601 timestamp; the reading at-or-before this time is used."),
  })
  .refine((d) => d.udi !== undefined || d.at !== undefined, {
    message: "Provide either udi (the reading id) or at (a timestamp) to identify the reading.",
  }));
type GuardrailInput = { assetName: string; udi?: number; at?: string };

export function defineCheckGuardrailsTool(runtime: ToolRuntime) {
  return tool({
    description:
      "Evaluate the deterministic heat-dissipation (HDF), power (PWF) and overstrain (OSF) guardrail rules against one stored reading of an asset. Provide the reading as a UDI row id, or as a timestamp. Returns each verdict with the thresholds applied and the observed values. TWF/RNF cannot be evaluated by this tool.",
    inputSchema: guardrailInput,
    execute: withToolBoundary("checkGuardrails", runtime, async (input: GuardrailInput) => {
      const assetId = await runtime.db.resolveAssetId(input.assetName);
      if (assetId === null) {
        return fail("NOT_FOUND", `Unknown asset "${input.assetName}".`);
      }

      const reading =
        input.udi !== undefined
          ? await runtime.db.getReadingByUdi(assetId, input.udi)
          : input.at !== undefined
            ? await runtime.db.getReadingAtOrBefore(assetId, new Date(input.at))
            : null;

      if (reading === null) {
        const what =
          input.udi !== undefined ? `UDI ${input.udi}` : `a reading at-or-before ${input.at}`;
        return fail("NOT_FOUND", `No reading matches ${what} for "${input.assetName}".`);
      }

      const sample: ProcessSample = {
        airTempK: reading.airTempK,
        processTempK: reading.processTempK,
        rotationalSpeedRpm: reading.rotationalSpeedRpm,
        torqueNm: reading.torqueNm,
        toolWearMin: reading.toolWearMin,
        productType: reading.qualityVariant,
      };

      const { verdicts, triggeredModes } = evaluateGuardrails(sample, AI4I_THRESHOLDS);

      runtime.recordEvidence(
        triggeredModes.map((mode) => ({ kind: "guardrail", mode })),
      );

      return ok({
        assetName: input.assetName,
        reading: {
          id: reading.id,
          recordedAt: reading.recordedAt,
          airTempK: reading.airTempK,
          processTempK: reading.processTempK,
          rotationalSpeedRpm: reading.rotationalSpeedRpm,
          torqueNm: reading.torqueNm,
          toolWearMin: reading.toolWearMin,
          productType: reading.qualityVariant,
        },
        triggeredModes,
        verdicts: verdicts.map((v) => ({
          mode: v.mode,
          triggered: v.triggered,
          observed: v.observed,
          thresholds: v.thresholds,
          reason: v.reason,
        })),
      });
    }),
  });
}