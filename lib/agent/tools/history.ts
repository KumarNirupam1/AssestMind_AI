import { tool, zodSchema } from "ai";
import { z } from "zod";

import {
  clampCount,
  FAULT_HISTORY_DEFAULT_LIMIT,
  FAULT_HISTORY_MAX_LIMIT,
  MAINTENANCE_DEFAULT_LIMIT,
  MAINTENANCE_MAX_LIMIT,
} from "../limits.ts";
import { withToolBoundary } from "../boundary.ts";
import type { ToolRuntime } from "../runtime.ts";
import { fail, ok } from "../types.ts";

/**
 * getFaultHistory + getMaintenanceHistory.
 *
 * Failure records are the machine-readable majority of the evidence trail,
 * so getFaultHistory records every returned fault id as citable evidence.
 * Maintenance records are context for *why* the fleet looks the way it does;
 * no maintenance citation type exists in the FROZEN scheme, so they surface
 * as context only.
 */

const faultInput = zodSchema(z.object({
  assetName: z.string().min(1).describe('Asset name, e.g. "PUMP-101".'),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Maximum number of fault records to return. Defaults to 12, capped at 25."),
}));
type FaultInput = { assetName: string; limit?: number };

export function defineGetFaultHistoryTool(runtime: ToolRuntime) {
  return tool({
    description:
      "Return the most recent failure records for one asset: mode (HDF/PWF/OSF/TWF/RNF), severity, occurred-at, whether resolved, and the recorded description. Use when the question asks about what has failed, when, or whether a failure was ever resolved.",
    inputSchema: faultInput,
    execute: withToolBoundary("getFaultHistory", runtime, async (input: FaultInput) => {
      const assetId = await runtime.db.resolveAssetId(input.assetName);
      if (assetId === null) {
        return fail("NOT_FOUND", `Unknown asset "${input.assetName}".`);
      }

      const limit = clampCount(input.limit, FAULT_HISTORY_DEFAULT_LIMIT, FAULT_HISTORY_MAX_LIMIT);
      const [faults, counts] = await Promise.all([
        runtime.db.listFaults(assetId, limit),
        runtime.db.countFaults(assetId),
      ]);

      runtime.recordEvidence(faults.map((f) => ({ kind: "fault", id: f.id })));

      return ok({
        assetName: input.assetName,
        allTimeFaultCount: counts.total,
        openFaultCount: counts.open,
        returnedCount: faults.length,
        faults: faults.map((f) => ({
          id: f.id,
          mode: f.mode,
          severity: f.severity,
          occurredAt: f.occurredAt,
          resolved: f.resolved,
          description: f.description,
        })),
      });
    }),
  });
}

const maintenanceInput = zodSchema(z.object({
  assetName: z.string().min(1).describe('Asset name, e.g. "PUMP-101".'),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Maximum number of maintenance records to return. Defaults to 12, capped at 25."),
}));
type MaintenanceInput = { assetName: string; limit?: number };

export function defineGetMaintenanceHistoryTool(runtime: ToolRuntime) {
  return tool({
    description:
      "Return the most recent maintenance, inspection and calibration records for one asset, with the work performed and the technician. Use to explain what maintenance has already been done and when.",
    inputSchema: maintenanceInput,
    execute: withToolBoundary("getMaintenanceHistory", runtime, async (input: MaintenanceInput) => {
      const assetId = await runtime.db.resolveAssetId(input.assetName);
      if (assetId === null) {
        return fail("NOT_FOUND", `Unknown asset "${input.assetName}".`);
      }

      const limit = clampCount(input.limit, MAINTENANCE_DEFAULT_LIMIT, MAINTENANCE_MAX_LIMIT);
      const logs = await runtime.db.listMaintenance(assetId, limit);

      return ok({
        assetName: input.assetName,
        returnedCount: logs.length,
        logs: logs.map((l) => ({
          id: l.id,
          type: l.type,
          performedAt: l.performedAt,
          description: l.description,
          technician: l.technician,
        })),
      });
    }),
  });
}