import { tool, zodSchema } from "ai";
import { z } from "zod";

import { ASSET_CONTEXT_OPEN_FAULT_CAP } from "../limits.ts";
import { withToolBoundary } from "../boundary.ts";
import type { ToolRuntime } from "../runtime.ts";
import { fail, ok } from "../types.ts";

/**
 * getAssetContext — the durable identity and state of one asset. Used to
 * anchor an investigation ("what is PUMP-101 and is it currently in a fault
 * state?") before reaching for history or guardrails.
 *
 * Unlike failures and documents, the context fields themselves are not
 * citable in the FROZEN scheme (`chunk`/`fault`/`guardrail` only), so the
 * returned open faults are ALSO recorded as evidence — without that, answers
 * about the current state could not cite them.
 */
export function defineGetAssetContextTool(runtime: ToolRuntime) {
  return tool({
    description:
      "Return the identity, specification, installed components, open-fault count and current unresolved faults of one asset. Call this first when a question names an asset you have not seen yet.",
    inputSchema: zodSchema(z.object({
      assetName: z.string().min(1).describe('Asset name, e.g. "PUMP-101".'),
    })),
    execute: withToolBoundary("getAssetContext", runtime, async ({ assetName }: { assetName: string }) => {
      const assetId = await runtime.db.resolveAssetId(assetName);
      if (assetId === null) {
        return fail("NOT_FOUND", `Unknown asset "${assetName}".`);
      }

      const context = await runtime.db.getAssetContext(assetId);
      if (context === null) {
        return fail("NOT_FOUND", `Asset "${assetName}" exists but has no readable context.`);
      }

      const openFaults = (await runtime.db.listFaults(assetId, ASSET_CONTEXT_OPEN_FAULT_CAP))
        .filter((f) => !f.resolved)
        .slice(0, ASSET_CONTEXT_OPEN_FAULT_CAP);

      runtime.recordEvidence(openFaults.map((f) => ({ kind: "fault", id: f.id })));

      return ok({
        assetName: context.name,
        model: context.model,
        serialNumber: context.serialNumber,
        manufacturer: context.manufacturer,
        site: context.site,
        installedAt: context.installedAt,
        status: context.status,
        components: context.components.map((c) => ({
          name: c.name,
          type: c.type,
          criticality: c.criticality,
        })),
        faultCounts: context.faults,
        documentCount: context.documentCount,
        openFaults: openFaults.map((f) => ({
          id: f.id,
          mode: f.mode,
          severity: f.severity,
          occurredAt: f.occurredAt,
          description: f.description,
        })),
      });
    }),
  });
}