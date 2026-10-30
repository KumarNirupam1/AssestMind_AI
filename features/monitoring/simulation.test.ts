import { describe, expect, it } from "vitest";

import { ProcessSampleSchema } from "@/features/guardrails/rules";
import {
  advanceSimulation,
  baselineSample,
  buildSnapshot,
  createRng,
  createSimulationState,
  detectAlerts,
  hashSeed,
  type SimulationScenario,
  type SimulationState,
} from "@/features/monitoring/simulation";

function runWithScenario(
  scenario: SimulationScenario,
  productType: "L" | "M" | "H" = "M",
) {
  const base = createSimulationState(baselineSample(productType), productType);
  const forced: SimulationState = {
    ...base,
    scenario,
    scenarioTicksLeft: 4,
    tick: 10,
  };
  return advanceSimulation(forced, createRng(hashSeed("asset-1")), 1_000);
}

describe("simulation rng", () => {
  it("is deterministic for the same seed", () => {
    const a = createRng(hashSeed("asset-alpha"));
    const b = createRng(hashSeed("asset-alpha"));
    const left = Array.from({ length: 20 }, () => a());
    const right = Array.from({ length: 20 }, () => b());
    expect(left).toEqual(right);
  });

  it("hashes different ids to different seeds", () => {
    expect(hashSeed("asset-alpha")).not.toBe(hashSeed("asset-beta"));
  });
});

describe("baseline sample", () => {
  it("is a valid process sample", () => {
    expect(() => ProcessSampleSchema.parse(baselineSample("H"))).not.toThrow();
  });
});

describe("advanceSimulation", () => {
  it("keeps telemetry finite and physically plausible over many ticks", () => {
    let state = createSimulationState(baselineSample("M"), "M");
    const rng = createRng(hashSeed("asset-plausible"));

    for (let i = 0; i < 300; i++) {
      const result = advanceSimulation(state, rng, i * 1500);
      state = result.state;
      const point = result.snapshot.point;

      expect(() => ProcessSampleSchema.parse(point)).not.toThrow();
      expect(point.airTempK).toBeGreaterThanOrEqual(295);
      expect(point.airTempK).toBeLessThanOrEqual(305);
      expect(point.processTempK).toBeGreaterThan(point.airTempK);
      expect(point.rotationalSpeedRpm).toBeGreaterThanOrEqual(900);
      expect(point.rotationalSpeedRpm).toBeLessThanOrEqual(1700);
      expect(point.torqueNm).toBeGreaterThanOrEqual(15);
      expect(point.toolWearMin).toBeLessThanOrEqual(240);
    }
  });

  it("starts the first simulated excursion on tick 6", () => {
    let state = createSimulationState(baselineSample("L"), "L");
    const rng = createRng(hashSeed("asset-schedule"));
    for (let i = 1; i <= 5; i++) {
      state = advanceSimulation(state, rng, i * 1500).state;
      expect(state.scenario).toBe("NORMAL");
    }
    state = advanceSimulation(state, rng, 6 * 1500).state;
    expect(state.scenario).not.toBe("NORMAL");
  });

  it("produces a HDF trigger when forced into the HDF scenario", () => {
    const { snapshot } = runWithScenario("HDF");
    expect(snapshot.evaluation.triggeredModes).toContain("HDF");
  });

  it("produces a PWF trigger when forced into the PWF scenario", () => {
    const { snapshot } = runWithScenario("PWF");
    expect(snapshot.evaluation.triggeredModes).toContain("PWF");
    expect(snapshot.powerW).toBeGreaterThan(9000);
  });

  it("produces an OSF trigger for every product type when forced", () => {
    for (const productType of ["L", "M", "H"] as const) {
      const { snapshot } = runWithScenario("OSF", productType);
      expect(snapshot.evaluation.triggeredModes).toContain("OSF");
    }
  });

  it("never exceeds the 240-minute tool-replacement band", () => {
    let state: SimulationState = {
      ...createSimulationState(baselineSample("M"), "M"),
      sample: { ...baselineSample("M"), toolWearMin: 239.9 },
      nextEventTick: 1_000_000,
    };
    const rng = createRng(hashSeed("asset-wear"));
    for (let i = 0; i < 200; i++) {
      state = advanceSimulation(state, rng, i * 1500).state;
      expect(state.sample.toolWearMin).toBeLessThanOrEqual(240);
    }
  });
});

describe("detectAlerts", () => {
  it("records an alert only on the rising edge of a trigger", () => {
    const normal = buildSnapshot(baselineSample("M"), "NORMAL", 1_000);
    const fired = runWithScenario("PWF").snapshot;

    const once = detectAlerts([], normal, fired, "asset-1");
    expect(once.length).toBeGreaterThan(0);
    expect(once.some((a) => a.mode === "PWF")).toBe(true);

    const repeated = detectAlerts(once, fired, fired, "asset-1");
    expect(repeated).toHaveLength(once.length);
  });
});
