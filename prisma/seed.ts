import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../lib/db";
import type { Prisma } from "../lib/generated/prisma/client";

const RNG_SEED = 20260126;
const EMBED_MODEL = "text-embedding-3-small";
const EMBED_DIM = 1536;
const CHUNKER_VERSION = "v1";
const CHUNK_TARGET_CHARS = 700;
const BASE_TIME = Date.UTC(2026, 0, 5, 6, 0, 0);
const MINUTES_PER_READING = 5;

/**
 * Asset identifiers.
 *
 * These follow the `PUMP-nnn` pump convention rather than describing the
 * AI4I hardware, because the original execution plan built its Phase 9 demo
 * around an asset called `Pump-102` and the team kept that framing. The
 * dataset is a simulated milling machine, so this is a deliberate
 * abstraction, not an accident. `docs/adr/0001-asset-naming.md` states the
 * abstraction and argues it, which is what
 * `docs/assetmind-ai-architecture.md` §3 requires before the name can be
 * used in the paper.
 *
 * Consequence to keep in mind: the Phase 2 guardrail rules are milling
 * rules (tool wear in minutes, torque x spindle speed, process vs air
 * temperature), so `checkGuardrails` reasons about cutting behaviour on a
 * nominally-pump asset. That is the cost of this choice and it is the first
 * thing a viva panel should be asked about.
 *
 * Do not confuse these with the Haas `VMC-850E` model strings below, which
 * are real product names and are not affected by this scheme.
 */
const ASSET_NAMES = [
  "PUMP-101",
  "PUMP-102",
  "PUMP-103",
  "PUMP-201",
  "PUMP-202",
  "PUMP-301",
  "PUMP-302",
  "PUMP-401",
] as const;

const ASSET_SPECS = [
  { model: "VMC-850E", manufacturer: "Haas", site: "Plant A / Bay 1", installed: "2019-03-14" },
  { model: "DMU-50", manufacturer: "DMG MORI", site: "Plant A / Bay 2", installed: "2019-08-02" },
  { model: "VCN-530C", manufacturer: "Mazak", site: "Plant A / Bay 3", installed: "2020-01-27" },
  { model: "GENOS-M560", manufacturer: "Okuma", site: "Plant B / Bay 1", installed: "2020-09-08" },
  { model: "a61nx", manufacturer: "Makino", site: "Plant B / Bay 2", installed: "2021-05-19" },
  { model: "DNM-5700", manufacturer: "Doosan", site: "Plant B / Bay 3", installed: "2022-02-11" },
  { model: "VMC-850E", manufacturer: "Haas", site: "Plant C / Bay 1", installed: "2022-11-30" },
  { model: "VCN-530C", manufacturer: "Mazak", site: "Plant C / Bay 2", installed: "2023-07-21" },
];

const COMPONENT_SPECS = [
  { name: "Spindle assembly", type: "SPINDLE", criticality: "CRITICAL" },
  { name: "Tool changer", type: "TOOL_CHANGER", criticality: "HIGH" },
  { name: "Coolant system", type: "COOLANT", criticality: "MEDIUM" },
  { name: "X-axis drive", type: "AXIS_DRIVE", criticality: "HIGH" },
  { name: "Z-axis drive", type: "AXIS_DRIVE", criticality: "HIGH" },
  { name: "Chip conveyor", type: "CONVEYOR", criticality: "LOW" },
  { name: "Enclosure interlock", type: "SAFETY", criticality: "MEDIUM" },
  { name: "Rotary table", type: "ROTARY", criticality: "MEDIUM" },
];

const MODE_ORDER = ["TWF", "HDF", "PWF", "OSF", "RNF"] as const;
type Mode = (typeof MODE_ORDER)[number];

const MODE_SEVERITY: Record<Mode, "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"> = {
  TWF: "HIGH",
  HDF: "MEDIUM",
  PWF: "MEDIUM",
  OSF: "CRITICAL",
  RNF: "LOW",
};

const MODE_NARRATIVE: Record<Mode, (udi: number) => string> = {
  TWF: (u) =>
    `Tool wear failure recorded at reading ${u}. The cutting tool exceeded its service life and the tool-change cycle did not restore surface finish. Inspect the tool holder and re-seat the spindle taper before restarting.`,
  HDF: (u) =>
    `Heat dissipation failure recorded at reading ${u}. Process temperature tracked too close to air temperature while the spindle was turning slowly, so heat was not being carried away by the coolant path. Check coolant flow rate and the spindle cooling fan.`,
  PWF: (u) =>
    `Power failure recorded at reading ${u}. Torque and rotational speed combined to demand power outside the normal cutting band, indicating a dull tool or an over-aggressive feed. Reduce feed rate and verify the programmed cutting speed.`,
  OSF: (u) =>
    `Overstrain failure recorded at reading ${u}. Accumulated tool wear acting against spindle torque exceeded the strain limit for this product variant. Replace the tool and review the cutting data table for this material.`,
  RNF: (u) =>
    `Random failure recorded at reading ${u}. No process parameter was outside its documented limit. Treated as an unclassified stop and logged for engineering review; it is not reproducible from the sensor values.`,
};

const EXPECTED_HEADER =
  "UDI,Product ID,Type,Air temperature [K],Process temperature [K],Rotational speed [rpm],Torque [Nm],Tool wear [min],Machine failure,TWF,HDF,PWF,OSF,RNF";

function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = makeRng(RNG_SEED);

function readAi4i() {
  const path = join(process.cwd(), "data", "raw", "ai4i2020.csv");
  const text = readFileSync(path, "utf8").replace(/^﻿/, "");
  const [header, ...lines] = text.trim().split(/\r?\n/);
  if (header !== EXPECTED_HEADER) {
    throw new Error(
      `Unexpected CSV header.\n  expected: ${EXPECTED_HEADER}\n  actual:   ${header}`,
    );
  }
  return lines.filter(Boolean).map((line) => line.split(","));
}

function chunkText(text: string): string[] {
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let current = "";
  for (const p of paragraphs) {
    if (current.length + p.length + 2 > CHUNK_TARGET_CHARS && current) {
      chunks.push(current);
      current = p;
    } else {
      current = current ? `${current}\n\n${p}` : p;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function manualBody(name: string, model: string, manufacturer: string): string {
  return [
    `${name} is a ${model} vertical machining centre manufactured by ${manufacturer}. The machine uses a BT40 spindle taper with a through-spindle coolant supply and a 24-station automatic tool changer.`,
    `Coolant is a 10% soluble-emulsion flood supply directed at the cutting zone, with an independent spindle coolant loop for thermal control. Air temperature at the machine inlet and process temperature at the workpiece are monitored continuously. Coolant flow below 4 L/min or a process-to-air differential below 8.6 K indicates the heat dissipation path is not working and the process should be stopped.`,
    `Spindle speed is commanded in revolutions per minute and spindle torque is measured at the drive. The useful cutting band sits between roughly 3500 W and 9000 W of combined torque and rotational speed. Sustained demand outside that band shortens tool life and risks overstrain damage to the ball screws.`,
    `Tool wear accumulates with cutting time and is reset when the tool is replaced. Service life depends on the product variant: light duty parts tolerate about 2 minutes of wear per cycle, medium duty 3 minutes, and heavy duty 5 minutes. Tools should be replaced before wear reaches 200 to 240 minutes of accumulated service.`,
    `The enclosure interlock must close before the spindle will enable. A fault narrative is generated automatically for every stop and stored against the asset so that the failure mode, the readings at the time, and the corrective action remain traceable.`,
  ].join("\n\n");
}

function sopBody(name: string): string {
  return [
    `${name} spindle inspection standard operating procedure. Lock out the machine, tag the disconnect, and verify zero energy state before removing the spindle cover.`,
    `Inspect the spindle taper and tool holder seating for chips and galling. Check spindle vibration against the baseline recorded at commissioning. Elevated vibration at constant cutting parameters usually indicates a damaged bearing or an unbalanced tool holder rather than a process fault.`,
    `Verify coolant delivery at the tool tip with a paper flow test. Confirm the coolant concentration is between 8% and 12% and that the spindle cooling loop is drawing measurable flow. Restore coolant pressure to 4 bar before returning the machine to service.`,
    `Torque the tool changer retention bolt to 45 Nm. Lubricate the tool changer cam follower with the specified grease at every scheduled service. Record the inspection result in the maintenance log against the asset.`,
  ].join("\n\n");
}

function inspectionBody(name: string, checks: { label: string; value: string }[]): string {
  return [
    `${name} routine inspection report. The following measurements were taken during the scheduled inspection window and are recorded for trending against the sensor history.`,
    ...checks.map((c) => `${c.label}: ${c.value}.`),
    `No out-of-limit condition was identified at the time of inspection. The inspection is a point-in-time observation and does not replace the continuous guardrail evaluation applied to each reading.`,
  ].join("\n\n");
}

async function main() {
  const rows = readAi4i();
  if (rows.length !== 10_000) {
    throw new Error(`Expected 10000 data rows, found ${rows.length}`);
  }

  console.log(`CSV parsed: ${rows.length} rows, RNG seed ${RNG_SEED}`);

  console.log("clearing existing rows");
  await prisma.chatMessage.deleteMany();
  await prisma.chat.deleteMany();
  await prisma.documentChunk.deleteMany();
  await prisma.document.deleteMany();
  await prisma.maintenanceLog.deleteMany();
  await prisma.faultRecord.deleteMany();
  await prisma.sensorReading.deleteMany();
  await prisma.component.deleteMany();
  await prisma.asset.deleteMany();

  const perAsset = Math.ceil(rows.length / ASSET_NAMES.length);
  const assetIdByName = new Map<string, string>();

  for (let i = 0; i < ASSET_SPECS.length; i += 1) {
    const spec = ASSET_SPECS[i];
    const name = ASSET_NAMES[i];
    const asset = await prisma.asset.create({
      data: {
        name,
        model: spec.model,
        manufacturer: spec.manufacturer,
        serialNumber: `SN-${String(100_000 + i * 1_337).padStart(6, "0")}`,
        site: spec.site,
        installedAt: new Date(`${spec.installed}T09:00:00.000Z`),
        status: "OPERATIONAL",
      },
    });
    assetIdByName.set(name, asset.id);

    await prisma.component.createMany({
      data: COMPONENT_SPECS.map((c, ci) => ({
        id: `${asset.id}-c${ci + 1}`,
        assetId: asset.id,
        name: c.name,
        type: c.type,
        criticality: c.criticality as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
      })),
    });
  }
  console.log(`assets: ${ASSET_SPECS.length}, components: ${ASSET_SPECS.length * COMPONENT_SPECS.length}`);

  const readings: {
    id: string;
    assetId: string;
    recordedAt: Date;
    airTempK: number;
    processTempK: number;
    rotationalSpeedRpm: number;
    torqueNm: number;
    toolWearMin: number;
    qualityVariant: "L" | "M" | "H";
    machineFailure: boolean;
    twf: boolean;
    hdf: boolean;
    pwf: boolean;
    osf: boolean;
    rnf: boolean;
  }[] = [];

  const faultsByAsset = new Map<string, { udi: number; mode: Mode; at: Date }[]>();
  const faultRecords: Prisma.FaultRecordCreateManyInput[] = [];
  const unattributed: { udi: number; qualityVariant: string; toolWearMin: number }[] = [];

  for (const cells of rows) {
    const udi = Number(cells[0]);
    const type = cells[2] as "L" | "M" | "H";
    const recordedAt = new Date(BASE_TIME + (udi - 1) * MINUTES_PER_READING * 60_000);
    const assetName = ASSET_NAMES[Math.floor((udi - 1) / perAsset)];
    const assetId = assetIdByName.get(assetName)!;

    const flags = {
      twf: cells[9] === "1",
      hdf: cells[10] === "1",
      pwf: cells[11] === "1",
      osf: cells[12] === "1",
      rnf: cells[13] === "1",
    };
    const machineFailure = cells[8] === "1";

    readings.push({
      id: String(udi),
      assetId,
      recordedAt,
      airTempK: Number(cells[3]),
      processTempK: Number(cells[4]),
      rotationalSpeedRpm: Number(cells[5]),
      torqueNm: Number(cells[6]),
      toolWearMin: Number(cells[7]),
      qualityVariant: type,
      machineFailure,
      ...flags,
    });

    if (!machineFailure) continue;

    // Mode is taken from the dataset's own per-mode ground-truth columns, not
    // from a rule evaluation. The Phase 2 guardrail engine is validated against
    // these labels; it must never be presented as their source.
    //
    // 9 of the 339 labelled failures carry no per-mode flag at all. The
    // dataset documentation attributes TWF to a randomly chosen tool-change
    // time, and these rows are consistent with replacement events rather than
    // an attributable condition. The reading is kept, the FaultRecord is
    // skipped, and the count is reported rather than silently absorbed.
    const mode = MODE_ORDER.find((m) => flags[m.toLowerCase() as keyof typeof flags]);
    if (!mode) {
      unattributed.push({ udi, qualityVariant: type, toolWearMin: Number(cells[7]) });
      continue;
    }

    const list = faultsByAsset.get(assetId) ?? [];
    list.push({ udi, mode, at: recordedAt });
    faultsByAsset.set(assetId, list);

    const resolved = udi % 3 !== 0;
    faultRecords.push({
      id: `f-${udi}`,
      assetId,
      sensorReadingId: String(udi),
      occurredAt: recordedAt,
      mode,
      severity: MODE_SEVERITY[mode],
      description: MODE_NARRATIVE[mode](udi),
      resolvedAt: resolved
        ? new Date(recordedAt.getTime() + (2 + Math.floor(rng() * 46)) * 3_600_000)
        : null,
    });
  }

  const BATCH = 1000;
  for (let i = 0; i < readings.length; i += BATCH) {
    await prisma.sensorReading.createMany({ data: readings.slice(i, i + BATCH) });
  }
  console.log(`sensor readings: ${readings.length}`);

  await prisma.faultRecord.createMany({ data: faultRecords });
  console.log(`fault records: ${faultRecords.length}`);
  if (unattributed.length > 0) {
    console.warn(
      `\nWARNING: ${unattributed.length} labelled failure(s) carry no per-mode flag and ` +
        `received no FaultRecord. Their SensorReading rows are still stored.\n` +
        `  UDI: ${unattributed.map((u) => u.udi).join(", ")}\n` +
        `  tool wear at those rows: ${unattributed.map((u) => u.toolWearMin).join(", ")} min\n` +
        `This is a property of the source dataset, not of the seed. Report it.`,
    );
  }

  const maintenanceLogs: Prisma.MaintenanceLogCreateManyInput[] = [];
  for (const [index, assetName] of ASSET_NAMES.entries()) {
    const assetId = assetIdByName.get(assetName)!;
    const faults = faultsByAsset.get(assetId) ?? [];
    const first = faults[0]?.at ?? new Date(BASE_TIME);

    for (const fault of faults.slice(0, 6)) {
      maintenanceLogs.push({
        id: `${assetId}-m-corr-${fault.udi}`,
        assetId,
        performedAt: new Date(fault.at.getTime() + 4 * 3_600_000),
        type: "CORRECTIVE",
        description: `Corrective action for ${fault.mode} at reading ${fault.udi}: ${MODE_NARRATIVE[fault.mode](fault.udi).split(". ")[0]}.`,
        technician: "M. Okafor",
      });
    }

    const schedule: { type: "PREVENTIVE" | "INSPECTION" | "CALIBRATION"; every: number; label: string }[] = [
      { type: "INSPECTION", every: 7, label: "Weekly spindle and coolant inspection." },
      { type: "PREVENTIVE", every: 14, label: "Scheduled preventive maintenance: lubrication, way inspection, coolant concentration." },
      { type: "CALIBRATION", every: 30, label: "Half-yearly calibration of spindle speed and torque measurement channels." },
    ];

    for (const item of schedule) {
      for (let d = item.every; d <= 34; d += item.every) {
        maintenanceLogs.push({
          id: `${assetId}-m-${item.type.toLowerCase()}-${d}`,
          assetId,
          performedAt: new Date(first.getTime() + d * 86_400_000 + 7_200_000),
          type: item.type,
          description: `${item.label} Completed with no out-of-tolerance condition.`,
          technician: ["M. Okafor", "R. Alvarez", "T. Nakamura"][index % 3],
        });
      }
    }
  }
  await prisma.maintenanceLog.createMany({ data: maintenanceLogs });
  console.log(`maintenance logs: ${maintenanceLogs.length}`);

  const documents: Prisma.DocumentCreateManyInput[] = [];
  const chunks: Prisma.DocumentChunkCreateManyInput[] = [];

  for (const [index, assetName] of ASSET_NAMES.entries()) {
    const assetId = assetIdByName.get(assetName)!;
    const spec = ASSET_SPECS[index];
    const faults = faultsByAsset.get(assetId) ?? [];
    const first = faults[0]?.at ?? new Date(BASE_TIME);
    const last = faults[faults.length - 1]?.at ?? new Date(BASE_TIME + 34 * 86_400_000);
    const failing = readings.filter((r) => r.assetId === assetId && r.machineFailure);
    const meanTorque =
      failing.length > 0
        ? failing.reduce((a, r) => a + r.torqueNm, 0) / failing.length
        : 0;

    const bodies: { type: "MANUAL" | "SOP" | "FAULT_NARRATIVE" | "INSPECTION_REPORT"; title: string; body: string }[] = [
      {
        type: "MANUAL",
        title: `${assetName} ${spec.model} operating manual`,
        body: manualBody(assetName, spec.model, spec.manufacturer),
      },
      {
        type: "SOP",
        title: `${assetName} spindle inspection procedure`,
        body: sopBody(assetName),
      },
      {
        type: "FAULT_NARRATIVE",
        title: `${assetName} fault history and recurring failure modes`,
        body: [
          `${assetName} recorded ${faults.length} labelled machine failures between ${first.toISOString().slice(0, 10)} and ${last.toISOString().slice(0, 10)}.`,
          ...MODE_ORDER.filter((m) => faults.some((f) => f.mode === m)).map(
            (m) =>
              `${m} occurred ${faults.filter((f) => f.mode === m).length} time(s). ${MODE_NARRATIVE[m](faults.find((f) => f.mode === m)!.udi)}`,
          ),
          `Mean spindle torque across failing readings was ${meanTorque.toFixed(1)} Nm, against a population mean of roughly 40 Nm. Elevated torque on failing cuts is the signature of a dull tool and is the primary indicator an engineer checks before changing a tool.`,
        ].join("\n\n"),
      },
      {
        type: "INSPECTION_REPORT",
        title: `${assetName} inspection report`,
        body: inspectionBody(assetName, [
          { label: "Coolant concentration", value: "9% soluble emulsion, within specification" },
          { label: "Spindle vibration RMS", value: `${(1.2 + rng() * 0.8).toFixed(2)} mm/s` },
          { label: "Coolant flow at tool tip", value: `${(4.2 + rng() * 1.6).toFixed(1)} L/min` },
          { label: "Axis backlash X", value: `${(0.008 + rng() * 0.006).toFixed(3)} mm` },
        ]),
      },
    ];

    for (const b of bodies) {
      const docId = `${assetId}-d-${b.type.toLowerCase()}`;
      documents.push({
        id: docId,
        assetId,
        title: b.title,
        docType: b.type,
        sourceKey: `synthetic://asset/${assetName}/${b.type.toLowerCase()}`,
        isSynthetic: true,
      });
      chunkText(b.body).forEach((content, ordinal) => {
        chunks.push({
          id: `${docId}-${ordinal}`,
          documentId: docId,
          ordinal,
          content,
          tokenCount: content.split(/\s+/).length,
          embedModel: EMBED_MODEL,
          embedDim: EMBED_DIM,
          chunkerVersion: CHUNKER_VERSION,
        });
      });
    }
  }

  await prisma.document.createMany({ data: documents });
  await prisma.documentChunk.createMany({ data: chunks });
  console.log(`documents: ${documents.length}, chunks: ${chunks.length} (embedding null until Phase 3)`);

  const counts = await Promise.all([
    prisma.asset.count(),
    prisma.component.count(),
    prisma.sensorReading.count(),
    prisma.faultRecord.count(),
    prisma.maintenanceLog.count(),
    prisma.document.count(),
    prisma.documentChunk.count(),
  ]);
  console.log("\nfinal row counts");
  console.table({
    Asset: counts[0],
    Component: counts[1],
    SensorReading: counts[2],
    FaultRecord: counts[3],
    MaintenanceLog: counts[4],
    Document: counts[5],
    DocumentChunk: counts[6],
  });
  console.log("seed complete");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
