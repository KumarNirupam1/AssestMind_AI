import {
  AI4I_THRESHOLDS,
  evaluateGuardrails,
  mechanicalPowerW,
  type GuardrailEvaluation,
  type ProcessSample,
  type ProductType,
} from "@/features/guardrails/rules";

/**
 * Deterministic plant-telemetry simulator.
 *
 * There is no real PLC/MQTT feed in this project, so the monitoring page runs
 * a *simulation* seeded from each asset's last stored sensor reading. It is
 * explicitly labelled simulated in the UI — presenting synthetic telemetry as
 * real plant data would be a research-integrity problem.
 *
 * The whole module is pure: RNG is injected and every function is a value
 * transform, so the engine is unit-testable and the same seed always produces
 * the same stream.
 */

export const MONITORING_INTERVAL_MS = 1500;
export const HISTORY_LIMIT = 48;

export type SimulationScenario = "NORMAL" | "HDF" | "PWF" | "OSF";

const SCENARIOS: readonly SimulationScenario[] = ["HDF", "PWF", "OSF"];

export type TelemetryPoint = ProcessSample & { at: number };

export type MonitoringSeed = {
  assetId: string;
  name: string;
  model: string;
  site: string | null;
  status: string;
  productType: ProductType;
  /** Latest stored reading, or a synthetic operational baseline. */
  base: ProcessSample;
  /** Recent stored readings (oldest → newest) used to prime the sparklines. */
  history: ProcessSample[];
  lastRecordedAt: string | null;
};

export type MonitoringSnapshot = {
  point: TelemetryPoint;
  powerW: number;
  tempDeltaK: number;
  osfLoad: number;
  scenario: SimulationScenario;
  evaluation: GuardrailEvaluation;
};

export type LiveAlert = {
  id: string;
  assetId: string;
  mode: string;
  reason: string;
  at: number;
};

export type SimulationState = {
  sample: ProcessSample;
  scenario: SimulationScenario;
  scenarioTicksLeft: number;
  tick: number;
  nextEventTick: number;
};

/** FNV-1a, used to turn an asset id into a stable RNG seed. */
export function hashSeed(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** mulberry32 — small, fast, deterministic PRNG in [0, 1). */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Plausible operating point for an asset with no stored readings. */
export function baselineSample(productType: ProductType): ProcessSample {
  const airTempK = 300.2;
  return {
    airTempK,
    processTempK: airTempK + 10.4,
    rotationalSpeedRpm: 1500,
    torqueNm: 44,
    toolWearMin: 32,
    productType,
  };
}

export function createSimulationState(
  base: ProcessSample,
  productType: ProductType,
): SimulationState {
  return {
    sample: { ...base, productType },
    scenario: "NORMAL",
    scenarioTicksLeft: 0,
    tick: 0,
    // First simulated excursion starts on tick 6 (~9s after load) so a demo
    // shows every guardrail in its healthy state before anything fires.
    nextEventTick: 6,
  };
}

export function buildSnapshot(
  sample: ProcessSample,
  scenario: SimulationScenario,
  now: number,
): MonitoringSnapshot {
  return {
    point: { ...sample, at: now },
    powerW: mechanicalPowerW(sample),
    tempDeltaK: Math.abs(sample.processTempK - sample.airTempK),
    osfLoad: sample.toolWearMin * sample.torqueNm,
    scenario,
    evaluation: evaluateGuardrails(sample),
  };
}

function evolve(
  current: ProcessSample,
  scenario: SimulationScenario,
  rng: () => number,
): ProcessSample {
  const productType = current.productType;
  const airTempK = clamp(current.airTempK + (rng() - 0.5) * 0.6, 295, 305);
  let deltaK: number;
  let speed: number;
  let torque: number;
  let wear = current.toolWearMin + 0.2 + rng() * 0.4;

  switch (scenario) {
    case "HDF":
      // Both HDF clauses must hold: |ΔT| < 8.6 K and speed < 1380 rpm.
      deltaK = clamp(4.6 + (rng() - 0.5) * 1.4, 2.5, 7.9);
      speed = clamp(1230 + (rng() - 0.5) * 120, 1000, 1360);
      torque = clamp(44 + (rng() - 0.5) * 16, 20, 70);
      break;
    case "PWF": {
      // Target a power above the 9000 W ceiling and derive torque from it, so
      // the failure is real for the mech-power formula rather than faked.
      deltaK = clamp(10.4 + (rng() - 0.5) * 2, 8.7, 16);
      speed = clamp(1500 + (rng() - 0.5) * 160, 1300, 1680);
      const targetPowerW = 9800 + rng() * 1800;
      torque = clamp((targetPowerW * 60) / (2 * Math.PI * speed), 20, 90);
      break;
    }
    case "OSF": {
      // Drive toolWear x torque above the per-product-type limit. Torque is
      // floored high enough that even the "H" limit is reachable under the
      // 240-minute replacement band.
      deltaK = clamp(10.4 + (rng() - 0.5) * 2, 8.7, 16);
      speed = clamp(1500 + (rng() - 0.5) * 140, 1300, 1680);
      torque = clamp(62 + (rng() - 0.5) * 12, 56, 80);
      const limit = AI4I_THRESHOLDS.osf.limitByType[productType];
      wear = clamp(limit / torque + 8 + rng() * 6, 0, 239);
      break;
    }
    default:
      deltaK = clamp(10.4 + (rng() - 0.5) * 2.4, 8.7, 17);
      speed = clamp(1500 + (rng() - 0.5) * 160, 1300, 1680);
      torque = clamp(44 + (rng() - 0.5) * 16, 20, 70);
      if (wear > 240) wear = 2 + rng() * 6;
      break;
  }

  if (wear > 240) wear = 2 + rng() * 6;

  return {
    airTempK,
    processTempK: airTempK + deltaK,
    rotationalSpeedRpm: speed,
    torqueNm: torque,
    toolWearMin: wear,
    productType,
  };
}

export function advanceSimulation(
  state: SimulationState,
  rng: () => number,
  now: number,
): { state: SimulationState; snapshot: MonitoringSnapshot } {
  const tick = state.tick + 1;
  let scenario = state.scenario;
  let scenarioTicksLeft = state.scenarioTicksLeft;
  let nextEventTick = state.nextEventTick;

  if (scenarioTicksLeft > 0) {
    scenarioTicksLeft -= 1;
    if (scenarioTicksLeft === 0) {
      scenario = "NORMAL";
      nextEventTick = tick + 40 + Math.floor(rng() * 40);
    }
  } else if (tick >= nextEventTick) {
    scenario = SCENARIOS[Math.floor(rng() * SCENARIOS.length)] ?? "HDF";
    scenarioTicksLeft = 5 + Math.floor(rng() * 4);
  }

  const sample = evolve(state.sample, scenario, rng);
  const nextState: SimulationState = {
    sample,
    scenario,
    scenarioTicksLeft,
    tick,
    nextEventTick,
  };

  return {
    state: nextState,
    snapshot: buildSnapshot(sample, scenario, now),
  };
}

/** Append trigger edges (not repeats) to a bounded alert feed. */
export function detectAlerts(
  existing: LiveAlert[],
  previous: MonitoringSnapshot,
  next: MonitoringSnapshot,
  assetId: string,
): LiveAlert[] {
  const already = new Set(previous.evaluation.triggeredModes);
  const fired = next.evaluation.triggeredModes.filter((mode) => !already.has(mode));
  if (fired.length === 0) return existing;

  const added = fired.map((mode) => {
    const verdict = next.evaluation.verdicts.find((v) => v.mode === mode);
    return {
      id: `${assetId}:${mode}:${next.point.at}`,
      assetId,
      mode,
      reason: verdict?.reason ?? "",
      at: next.point.at,
    };
  });

  return [...added.reverse(), ...existing].slice(0, 8);
}
