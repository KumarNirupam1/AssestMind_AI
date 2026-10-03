import type { Tool, ToolSet } from "ai";
import { describe, expect, it } from "vitest";

import {
  EVIDENCE_ENTRY_SCHEMA,
  TOOL_CALL_ENTRY_SCHEMA,
  type ToolCallEntry,
} from "@/features/evaluation/run-manifest";
import { TOOL_CONFIGS_FROZEN, TOOL_NAMES_FROZEN } from "@/features/evaluation/question-set";
import { createDeterministicEmbeddingProvider } from "@/features/ingestion/embedding";
import type { AssetStatus, FaultMode, MaintenanceType, QualityVariant, Severity } from "@/lib/generated/prisma/enums";
import { buildToolRegistry } from "@/lib/agent/registry";
import type { ToolOutcome } from "@/lib/agent/types";
import type { ToolDb } from "@/lib/agent/tool-db";
import { withToolBoundary } from "@/lib/agent/boundary";

// ---------------------------------------------------------------------------
// In-memory ToolDb. Same interface the Prisma-backed version implements, so the
// tool modules under test are exactly the modules the route and the eval
// harness run.
// ---------------------------------------------------------------------------

const PUMP_ID = "a-1";

const reading5: Reading = {
  id: "5",
  recordedAt: new Date("2026-09-29T00:00:00Z"),
  airTempK: 300,
  processTempK: 305,
  rotationalSpeedRpm: 1200,
  torqueNm: 40,
  toolWearMin: 50,
  qualityVariant: "L",
};

const reading6: Reading = {
  id: "6",
  recordedAt: new Date("2026-09-29T00:10:00Z"),
  airTempK: 300,
  processTempK: 320,
  rotationalSpeedRpm: 1500,
  torqueNm: 50,
  toolWearMin: 50,
  qualityVariant: "L",
};

const faults: Fault[] = [
  {
    id: "f-1",
    mode: "HDF",
    severity: "HIGH",
    occurredAt: new Date("2026-09-20T00:00:00Z"),
    resolved: false,
    description: "Heat-dissipation failure",
  },
  {
    id: "f-2",
    mode: "OSF",
    severity: "MEDIUM",
    occurredAt: new Date("2026-09-19T00:00:00Z"),
    resolved: false,
    description: "Overstrain failure",
  },
  {
    id: "f-3",
    mode: "PWF",
    severity: "LOW",
    occurredAt: new Date("2026-09-18T00:00:00Z"),
    resolved: true,
    description: "Power failure",
  },
];

type Reading = {
  id: string;
  recordedAt: Date;
  airTempK: number;
  processTempK: number;
  rotationalSpeedRpm: number;
  torqueNm: number;
  toolWearMin: number;
  qualityVariant: QualityVariant;
};

type Fault = {
  id: string;
  mode: FaultMode;
  severity: Severity;
  occurredAt: Date;
  resolved: boolean;
  description: string;
};

function makeFakeDb(): ToolDb {
  return {
    async resolveAssetId(name) {
      return name === "PUMP-101" ? PUMP_ID : null;
    },
    async rawQuery<T>(sql: string, params: unknown[]): Promise<T[]> {
      void params;
      const vector = sql.includes("embedding");
      const base = [
        {
          id: "doc-1-d-0",
          ordinal: 0,
          content: "One-line procedure summary.",
          title: "PUMP-101 operating manual",
          docType: "MANUAL",
          sourceKey: "manuals/pump-101.md",
          isSynthetic: true,
        },
        {
          id: "doc-1-d-1",
          ordinal: 1,
          content: "Inspection milestones in the SOP.",
          title: "PUMP-101 SOP",
          docType: "SOP",
          sourceKey: "sops/pump-101.md",
          isSynthetic: true,
        },
      ];
      const rows = vector
        ? base.map((r) => ({ ...r, distance: r.id.includes("d-0") ? 0.11 : 0.24 }))
        : base.map((r) => ({ ...r, rank: r.id.includes("d-0") ? 0.92 : 0.61 }));
      return rows as T[];
    },
    async getAssetContext(assetId) {
      if (assetId !== PUMP_ID) return null;
      return {
        id: PUMP_ID,
        name: "PUMP-101",
        model: "M-500",
        serialNumber: "SN-1",
        manufacturer: "Acme",
        site: "North site",
        installedAt: new Date("2022-01-01T00:00:00Z"),
        status: "OPERATIONAL" as AssetStatus,
        components: [{ name: "Impeller", type: "Impeller", criticality: "HIGH" as Severity }],
        faults: { total: 12, open: 2 },
        documentCount: 1,
      };
    },
    async listFaults(assetId, limit) {
      void assetId;
      return faults.slice(0, limit).map((f) => ({ ...f }));
    },
    async countFaults(assetId) {
      void assetId;
      return { total: 12, open: 2 };
    },
    async listMaintenance(assetId, limit) {
      void assetId;
      return [
        {
          id: "a-1-m-corr-5",
          type: "CORRECTIVE" as MaintenanceType,
          performedAt: new Date("2026-09-21T00:00:00Z"),
          description: "Bearing replaced",
          technician: "T-1",
        },
      ].slice(0, limit);
    },
    async getReadingByUdi(assetId, udi) {
      void assetId;
      const row = udi === 5 ? reading5 : udi === 6 ? reading6 : null;
      return row ? { ...row } : null;
    },
    async getReadingAtOrBefore(assetId, at) {
      void assetId;
      void at;
      return { ...reading6 };
    },
  };
}

const embed = createDeterministicEmbeddingProvider();

type Harness = {
  tools: ToolSet;
  runtime: ReturnType<typeof makeRuntime>;
};

function makeRuntime(): {
  db: ToolDb;
  toolCalls: ToolCallEntry[];
  evidence: unknown[];
  embed: typeof embed;
  recordToolCall: (e: ToolCallEntry) => void;
  recordEvidence: (e: unknown[]) => void;
  timeoutMs: number;
} {
  const toolCalls: ToolCallEntry[] = [];
  const evidence: unknown[] = [];
  return {
    db: makeFakeDb(),
    toolCalls,
    evidence,
    embed,
    recordToolCall(e) {
      toolCalls.push(e);
    },
    recordEvidence(e) {
      evidence.push(...e);
    },
    timeoutMs: 5_000,
  };
}

async function runTool(tool: Tool, input: unknown): Promise<ToolOutcome<unknown>> {
  const fn = tool.execute as unknown as (i: unknown) => Promise<ToolOutcome<unknown>>;
  return fn(input);
}

function harnessFor(names: readonly (typeof TOOL_NAMES_FROZEN)[number][]): Harness {
  const runtime = makeRuntime();
  const tools = buildToolRegistry(names, runtime);
  return { tools, runtime };
}

function latestCall(runtime: Harness["runtime"]): ToolCallEntry {
  return runtime.toolCalls[runtime.toolCalls.length - 1];
}

// zod-parse every recorded call + evidence — the eval manifest must accept
// everything the tools emit.
function assertManifestConformant(runtime: Harness["runtime"]): void {
  for (const call of runtime.toolCalls) {
    expect(() => TOOL_CALL_ENTRY_SCHEMA.parse(call)).not.toThrow();
  }
  for (const e of runtime.evidence) {
    expect(() => EVIDENCE_ENTRY_SCHEMA.parse(e)).not.toThrow();
  }
}

describe("buildToolRegistry", () => {
  it("builds all six tools for config 5", () => {
    const { tools } = harnessFor(TOOL_NAMES_FROZEN);
    expect(Object.keys(tools).sort()).toEqual([...TOOL_NAMES_FROZEN].sort());
  });

  it("builds each FROZEN config as the right subset", () => {
    for (const key of [1, 2, 3, 4, 5] as const) {
      const { tools } = harnessFor(TOOL_CONFIGS_FROZEN[key]);
      expect(Object.keys(tools).sort()).toEqual([...TOOL_CONFIGS_FROZEN[key]].sort());
    }
  });

  it("rejects a tool name outside the FROZEN registry", () => {
    const runtime = makeRuntime();
    expect(() =>
      buildToolRegistry(["getAssetContext", "notATool"] as never, runtime),
    ).toThrow(/not in the FROZEN registry/);
  });

  it("de-duplicates repeated names", () => {
    const { tools } = harnessFor(["getAssetContext", "getAssetContext"]);
    expect(Object.keys(tools)).toHaveLength(1);
  });

  it("returns an empty registry for a no-tools config", () => {
    const { tools } = harnessFor([]);
    expect(tools).toEqual({});
  });
});

describe("tools against the fake ToolDb", () => {
  it("getAssetContext returns context and citable open faults", async () => {
    const { tools, runtime } = harnessFor(["getAssetContext"]);
    const outcome = await runTool(tools.getAssetContext, { assetName: "PUMP-101" });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.data).toMatchObject({
        assetName: "PUMP-101",
        faultCounts: { total: 12, open: 2 },
        status: "OPERATIONAL",
      });
    }
    expect(runtime.evidence).toContainEqual({ kind: "fault", id: "f-1" });
    expect(latestCall(runtime)).toMatchObject({ name: "getAssetContext", outcome: "SUCCESS" });
    assertManifestConformant(runtime);
  });

  it("getAssetContext degrades to NOT_FOUND for an unknown asset", async () => {
    const { tools, runtime } = harnessFor(["getAssetContext"]);
    const outcome = await runTool(tools.getAssetContext, { assetName: "PUMP-999" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe("NOT_FOUND");
    expect(latestCall(runtime).outcome).toBe("NOT_FOUND");
  });

  it("getFaultHistory returns rows, counts and fault evidence", async () => {
    const { tools, runtime } = harnessFor(["getFaultHistory"]);
    const outcome = await runTool(tools.getFaultHistory, { assetName: "PUMP-101" });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.data).toMatchObject({
        allTimeFaultCount: 12,
        openFaultCount: 2,
        returnedCount: 3,
      });
      expect((outcome.data as { faults: unknown[] }).faults).toHaveLength(3);
    }
    expect(runtime.evidence).toContainEqual({ kind: "fault", id: "f-1" });
    expect(latestCall(runtime).outcome).toBe("SUCCESS");
    assertManifestConformant(runtime);
  });

  it("getMaintenanceHistory returns rows without claiming evidence", async () => {
    const { tools, runtime } = harnessFor(["getMaintenanceHistory"]);
    const outcome = await runTool(tools.getMaintenanceHistory, { assetName: "PUMP-101" });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect((outcome.data as { logs: unknown[] }).logs).toHaveLength(1);
    }
    expect(runtime.evidence).toHaveLength(0);
    expect(latestCall(runtime).outcome).toBe("SUCCESS");
  });

  it("checkGuardrails fires HDF on a stored reading and records guardrail evidence", async () => {
    const { tools, runtime } = harnessFor(["checkGuardrails"]);
    const outcome = await runTool(tools.checkGuardrails, { assetName: "PUMP-101", udi: 5 });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect((outcome.data as { triggeredModes: string[] }).triggeredModes).toEqual(["HDF"]);
      expect((outcome.data as { verdicts: unknown[] }).verdicts).toHaveLength(3);
    }
    expect(runtime.evidence).toContainEqual({ kind: "guardrail", mode: "HDF" });
    expect(latestCall(runtime).outcome).toBe("SUCCESS");
    assertManifestConformant(runtime);
  });

  it("checkGuardrails records no guardrail evidence when nothing fires", async () => {
    const { tools, runtime } = harnessFor(["checkGuardrails"]);
    const outcome = await runTool(tools.checkGuardrails, { assetName: "PUMP-101", udi: 6 });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect((outcome.data as { triggeredModes: string[] }).triggeredModes).toEqual([]);
    expect(runtime.evidence).toHaveLength(0);
  });

  it("checkGuardrails resolves the at-or-before path when at is given", async () => {
    const { tools } = harnessFor(["checkGuardrails"]);
    const outcome = await runTool(tools.checkGuardrails, {
      assetName: "PUMP-101",
      at: "2026-09-29T00:30:00Z",
    });
    expect(outcome.ok).toBe(true);
  });

  it("searchDocumentsVector pins the provider and records chunk evidence", async () => {
    const { tools, runtime } = harnessFor(["searchDocumentsVector"]);
    const outcome = await runTool(tools.searchDocumentsVector, {
      query: "operating procedure",
      assetName: "PUMP-101",
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      const data = outcome.data as { count: number; embedModel: string; hits: { distance: number }[] };
      expect(data.count).toBe(2);
      expect(data.embedModel).toBe(embed.id);
      expect(data.hits[0].distance).toBe(0.11);
    }
    expect(runtime.evidence).toContainEqual({ kind: "chunk", id: "doc-1-d-0", ordinal: 0 });
    expect(latestCall(runtime).outcome).toBe("SUCCESS");
    assertManifestConformant(runtime);
  });

  it("searchDocumentsKeyword returns rank-ranked hits", async () => {
    const { tools, runtime } = harnessFor(["searchDocumentsKeyword"]);
    const outcome = await runTool(tools.searchDocumentsKeyword, { query: "limit", topK: 2 });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      const data = outcome.data as { count: number; hits: { rank: number }[] };
      expect(data.count).toBe(2);
      expect(data.hits[0].rank).toBeCloseTo(0.92);
    }
    expect(latestCall(runtime).outcome).toBe("SUCCESS");
  });

  it("rejects an empty query as INVALID_INPUT without spending a retry", async () => {
    const { tools, runtime } = harnessFor(["searchDocumentsVector"]);
    const outcome = await runTool(tools.searchDocumentsVector, { query: "   " });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe("INVALID_INPUT");
    expect(runtime.toolCalls).toHaveLength(1);
    expect(runtime.toolCalls[0].outcome).toBe("INVALID_INPUT");
  });

  it("maps an unknown asset scope to NOT_FOUND", async () => {
    const { tools, runtime } = harnessFor(["checkGuardrails"]);
    const outcome = await runTool(tools.checkGuardrails, { assetName: "PUMP-999", udi: 5 });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe("NOT_FOUND");
    expect(latestCall(runtime).outcome).toBe("NOT_FOUND");
  });
});

// The boundary records every call through the FROZEN taxonomy.
describe("withToolBoundary", () => {
  it("records a SUCCESS call with duration for a fast tool", async () => {
    const runtime = makeRuntime();
    const wrapped = withToolBoundary(
      "getAssetContext",
      runtime,
      async () => ({ ok: true as const, data: { n: 1 } }),
    );
    const outcome = await wrapped({}, {} as never);
    expect(outcome.ok).toBe(true);
    expect(runtime.toolCalls).toHaveLength(1);
    expect(runtime.toolCalls[0]).toMatchObject({ name: "getAssetContext", outcome: "SUCCESS" });
    expect(runtime.toolCalls[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it("records the FROZEN code of a failure, with the outcome unchanged", async () => {
    const runtime = makeRuntime();
    const wrapped = withToolBoundary(
      "checkGuardrails",
      runtime,
      async () => ({ ok: false as const, error: { code: "TIMEOUT" as const, message: "slow" } }),
    );
    const outcome = await wrapped({}, {} as never);
    expect(outcome).toEqual({ ok: false, error: { code: "TIMEOUT", message: "slow" } });
    expect(runtime.toolCalls[0].outcome).toBe("TIMEOUT");
  });
});