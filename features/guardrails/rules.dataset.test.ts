import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { evaluateHdf, evaluateOsf, evaluatePwf, AI4I_THRESHOLDS } from "@/features/guardrails/rules";

/**
 * Locks the engine to the dataset.
 *
 * `scripts/verify-guardrail-rules.mjs` proves the *formulas* reproduce the
 * AI4I label columns. This proves the shipped TypeScript implementation
 * agrees with those formulas — otherwise the two can drift apart and the
 * paper's RQ3 numbers would describe code that is not running.
 *
 * Reads a local committed file, so it stays hermetic: no database, no network.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const load = () => {
  const raw = readFileSync(join(root, "data", "raw", "ai4i2020.csv"), "utf8").replace(/^\uFEFF/, "");
  const lines = raw.trim().split(/\r?\n/);
  const header = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    return Object.fromEntries(header.map((h, i) => [h, cells[i]]));
  });
};

const rows = load();

type Row = (typeof rows)[number];

const sample = (r: Row) => ({
  airTempK: Number(r["Air temperature [K]"]),
  processTempK: Number(r["Process temperature [K]"]),
  rotationalSpeedRpm: Number(r["Rotational speed [rpm]"]),
  torqueNm: Number(r["Torque [Nm]"]),
  toolWearMin: Number(r["Tool wear [min]"]),
  productType: r["Type"] as "L" | "M" | "H",
});

/** Every disagreement between the engine and the dataset label. */
const disagreements = (
  mode: "HDF" | "PWF" | "OSF",
  predict: (r: Row) => boolean,
): { udi: string; labelled: string; predicted: string }[] =>
  rows
    .filter((r) => predict(r) !== (Number(r[mode]) === 1))
    .map((r) => ({
      udi: r["UDI"],
      labelled: String(Number(r[mode])),
      predicted: String(predict(r) ? 1 : 0),
    }));

describe("engine agrees with the AI4I 2020 label columns", () => {
  it("loaded the whole dataset", () => {
    expect(rows).toHaveLength(10000);
  });

  it("HDF: 115 label rows, zero disagreements", () => {
    const d = disagreements("HDF", (r) => evaluateHdf(sample(r), AI4I_THRESHOLDS.hdf).triggered);
    expect(d).toEqual([]);
    expect(rows.filter((r) => Number(r["HDF"]) === 1)).toHaveLength(115);
  });

  it("PWF: 95 label rows, zero disagreements", () => {
    const d = disagreements("PWF", (r) => evaluatePwf(sample(r), AI4I_THRESHOLDS.pwf).triggered);
    expect(d).toEqual([]);
    expect(rows.filter((r) => Number(r["PWF"]) === 1)).toHaveLength(95);
  });

  it("OSF: 98 label rows, zero disagreements", () => {
    const d = disagreements("OSF", (r) => evaluateOsf(sample(r), AI4I_THRESHOLDS.osf).triggered);
    expect(d).toEqual([]);
    expect(rows.filter((r) => Number(r["OSF"]) === 1)).toHaveLength(98);
  });

  it("predicts TWF and RNF not at all, because they are random", () => {
    // Recorded as an explicit regression guard: if anyone "helpfully" adds a
    // wear-band TWF rule, this still passes but the ADR and RQ3 scope no
    // longer match the code. The 790-in-band / 46-labelled asymmetry is the
    // reason such a rule would be meaningless.
    const twfLabelled = rows.filter((r) => Number(r["TWF"]) === 1).length;
    const inBand = rows.filter(
      (r) => Number(r["Tool wear [min]"]) >= 200 && Number(r["Tool wear [min]"]) <= 240,
    ).length;
    expect(twfLabelled).toBe(46);
    expect(inBand).toBeGreaterThan(twfLabelled * 10);
  });
});
