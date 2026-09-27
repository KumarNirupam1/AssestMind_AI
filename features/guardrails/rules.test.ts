import { describe, expect, it } from "vitest";

import {
  AI4I_THRESHOLDS,
  type GuardrailThreshold,
  type ProcessSample,
  GUARDRAIL_MODES,
  evaluateGuardrails,
  evaluateHdf,
  evaluateOsf,
  evaluatePwf,
  mechanicalPowerW,
} from "@/features/guardrails/rules";

/**
 * These thresholds reproduce the AI4I 2020 label columns exactly, so the
 * boundaries are correctness-critical, not tuning parameters. A change here
 * that breaks label agreement is a regression, and `npm run verify:rules`
 * will fail in CI.
 */

const sample = (over: Partial<ProcessSample> = {}): ProcessSample => ({
  airTempK: 298.3,
  processTempK: 308.1,
  rotationalSpeedRpm: 1500,
  torqueNm: 40,
  toolWearMin: 100,
  productType: "L",
  ...over,
});

/** Torque needed to hit an exact power at a given speed. */
const torqueForPower = (powerW: number, speedRpm: number) =>
  (powerW * 60) / (2 * Math.PI * speedRpm);

describe("modes that are decidable", () => {
  it("covers exactly the three deterministic modes", () => {
    // TWF and RNF are random in AI4I and deliberately excluded. If someone
    // adds them here, per-mode precision/recall becomes meaningless.
    expect(GUARDRAIL_MODES).toEqual(["HDF", "PWF", "OSF"]);
    expect(GUARDRAIL_MODES).not.toContain("TWF");
    expect(GUARDRAIL_MODES).not.toContain("RNF");
  });

  it("returns a structured verdict for every mode, not a boolean", () => {
    const { verdicts } = evaluateGuardrails(sample());
    expect(verdicts).toHaveLength(3);
    for (const v of verdicts) {
      expect(v.mode).toMatch(/^(HDF|PWF|OSF)$/);
      expect(typeof v.triggered).toBe("boolean");
      // Evidence for RQ3 re-scoring must survive storage.
      expect(Object.keys(v.observed).length).toBeGreaterThan(0);
      expect(Object.keys(v.thresholds).length).toBeGreaterThan(0);
      expect(v.clauses.length).toBeGreaterThan(0);
      expect(v.reason.length).toBeGreaterThan(0);
    }
  });
});

describe("HDF", () => {
  const t = AI4I_THRESHOLDS.hdf;

  it("fires when both clauses are met", () => {
    const v = evaluateHdf(sample({ processTempK: 298.3 + 8.5, rotationalSpeedRpm: 1379 }), t);
    expect(v.triggered).toBe(true);
    expect(v.clauses.every((c) => c.met)).toBe(true);
  });

  it("requires BOTH clauses — low delta alone does not fire", () => {
    const v = evaluateHdf(sample({ processTempK: 298.3 + 8.5, rotationalSpeedRpm: 2000 }), t);
    expect(v.triggered).toBe(false);
    expect(v.clauses.find((c) => c.name === "tempDelta")?.met).toBe(true);
    expect(v.clauses.find((c) => c.name === "lowSpeed")?.met).toBe(false);
  });

  it("requires BOTH clauses — low speed alone does not fire", () => {
    const v = evaluateHdf(sample({ processTempK: 298.3 + 9.8, rotationalSpeedRpm: 1200 }), t);
    expect(v.triggered).toBe(false);
    expect(v.clauses.find((c) => c.name === "tempDelta")?.met).toBe(false);
    expect(v.clauses.find((c) => c.name === "lowSpeed")?.met).toBe(true);
  });

  it("treats both limits as exclusive", () => {
    // Exactly at the temperature limit: not below it, so no fire.
    expect(evaluateHdf(sample({ processTempK: 298.3 + 8.6, rotationalSpeedRpm: 1200 }), t).triggered).toBe(false);
    // Exactly at the speed limit: not below it, so no fire.
    expect(evaluateHdf(sample({ processTempK: 298.3 + 8.5, rotationalSpeedRpm: 1380 }), t).triggered).toBe(false);
    // Just inside both: fires.
    expect(evaluateHdf(sample({ processTempK: 298.3 + 8.59, rotationalSpeedRpm: 1379 }), t).triggered).toBe(true);
  });

  it("uses the absolute temperature difference", () => {
    // Process temperature *below* air temperature by more than the limit is
    // still a large difference and must not fire. A signed
    // `airTemp - processTemp < 8.6` reading would fire here.
    const v = evaluateHdf(sample({ airTempK: 320, processTempK: 300, rotationalSpeedRpm: 1200 }), t);
    expect(v.triggered).toBe(false);
  });
});

describe("PWF", () => {
  const t = AI4I_THRESHOLDS.pwf;
  const speed = 1500;

  it("converts torque and rpm to watts", () => {
    // 40 Nm at 1500 rpm is ~6.3 kW, inside the band.
    expect(mechanicalPowerW(sample())).toBeGreaterThan(6000);
    expect(mechanicalPowerW(sample())).toBeLessThan(6400);
  });

  it("fires below the minimum power", () => {
    const v = evaluatePwf(sample({ torqueNm: torqueForPower(3400, speed), rotationalSpeedRpm: speed }), t);
    expect(v.triggered).toBe(true);
    expect(v.observed.powerW).toBeCloseTo(3400, 6);
  });

  it("fires above the maximum power", () => {
    const v = evaluatePwf(sample({ torqueNm: torqueForPower(9500, speed), rotationalSpeedRpm: speed }), t);
    expect(v.triggered).toBe(true);
    expect(v.observed.powerW).toBeCloseTo(9500, 6);
  });

  it("treats both power limits as exclusive", () => {
    expect(evaluatePwf(sample({ torqueNm: torqueForPower(3500, speed), rotationalSpeedRpm: speed }), t).triggered).toBe(false);
    expect(evaluatePwf(sample({ torqueNm: torqueForPower(9000, speed), rotationalSpeedRpm: speed }), t).triggered).toBe(false);
  });

  it("stays quiet inside the band", () => {
    expect(evaluatePwf(sample({ torqueNm: torqueForPower(6000, speed), rotationalSpeedRpm: speed }), t).triggered).toBe(false);
  });
});

describe("OSF", () => {
  const t = AI4I_THRESHOLDS.osf;

  it("fires above the limit", () => {
    expect(evaluateOsf(sample({ toolWearMin: 200, torqueNm: 60, productType: "L" }), t).triggered).toBe(true);
  });

  it("treats the limit as exclusive", () => {
    // 200 * 60 = 12000, which is the M limit, not the L limit.
    expect(evaluateOsf(sample({ toolWearMin: 200, torqueNm: 55, productType: "L" }), t).triggered).toBe(false);
    expect(evaluateOsf(sample({ toolWearMin: 200, torqueNm: 55.01, productType: "L" }), t).triggered).toBe(true);
  });

  it("applies a different limit per product type", () => {
    const s = { toolWearMin: 200, torqueNm: 60 };
    // strain = 12000 minNm
    expect(evaluateOsf({ ...sample(), ...s, productType: "L" }, t).triggered).toBe(true);
    expect(evaluateOsf({ ...sample(), ...s, productType: "M" }, t).triggered).toBe(false);
    expect(evaluateOsf({ ...sample(), ...s, productType: "H" }, t).triggered).toBe(false);
  });

  it("uses the H limit for an H product at the same strain", () => {
    // H limit is 13000 minNm, so at 60 Nm the boundary sits at 216.67 min.
    expect(evaluateOsf(sample({ toolWearMin: 216, torqueNm: 60, productType: "H" }), t).triggered).toBe(false);
    expect(evaluateOsf(sample({ toolWearMin: 217, torqueNm: 60, productType: "H" }), t).triggered).toBe(true);
  });
});

describe("threshold configuration", () => {
  it("rejects an inverted power band", () => {
    const bad: GuardrailThreshold = {
      ...AI4I_THRESHOLDS,
      pwf: { minPowerW: 9000, maxPowerW: 3500 },
    };
    expect(() => evaluateGuardrails(sample(), bad)).toThrow();
  });

  it("rejects a sample with an unknown product type", () => {
    expect(() =>
      evaluateGuardrails({ ...sample(), productType: "X" } as unknown as ProcessSample),
    ).toThrow();
  });

  it("rejects non-finite readings rather than evaluating them", () => {
    expect(() => evaluateGuardrails(sample({ torqueNm: Number.NaN }))).toThrow();
  });
});
