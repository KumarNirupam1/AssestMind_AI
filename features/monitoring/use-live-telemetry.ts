"use client";

import * as React from "react";

import {
  advanceSimulation,
  buildSnapshot,
  createRng,
  createSimulationState,
  detectAlerts,
  hashSeed,
  HISTORY_LIMIT,
  MONITORING_INTERVAL_MS,
  type LiveAlert,
  type MonitoringSeed,
  type MonitoringSnapshot,
  type SimulationState,
  type TelemetryPoint,
} from "@/features/monitoring/simulation";

export type AssetLiveState = {
  seed: MonitoringSeed;
  snapshot: MonitoringSnapshot;
  history: TelemetryPoint[];
  alerts: LiveAlert[];
};

type Engine = { rng: () => number; state: SimulationState };

function initialState(seeds: MonitoringSeed[]): AssetLiveState[] {
  return seeds.map((seed) => ({
    seed,
    // `at: 0` keeps the server and first client render identical (no
    // hydration mismatch from Date.now()); real timestamps start on tick 1.
    snapshot: buildSnapshot(seed.base, "NORMAL", 0),
    history: seed.history.slice(-HISTORY_LIMIT).map((sample) => ({ ...sample, at: 0 })),
    alerts: [],
  }));
}

function buildEngines(seeds: MonitoringSeed[]): Record<string, Engine> {
  return Object.fromEntries(
    seeds.map((seed) => [
      seed.assetId,
      {
        rng: createRng(hashSeed(seed.assetId)),
        state: createSimulationState(seed.base, seed.productType),
      },
    ]),
  );
}

/**
 * Client-side telemetry loop. Advances every asset's simulator on a fixed
 * interval and keeps a bounded history + rising-edge alert feed. No DB writes:
 * this is a simulated feed, seeded from the last stored reading.
 */
export function useLiveTelemetry(
  seeds: MonitoringSeed[],
  intervalMs: number = MONITORING_INTERVAL_MS,
) {
  const [assets, setAssets] = React.useState<AssetLiveState[]>(() => initialState(seeds));
  const [tick, setTick] = React.useState(0);
  const [paused, setPaused] = React.useState(false);

  const engines = React.useRef<Record<string, Engine> | null>(null);
  if (engines.current === null) engines.current = buildEngines(seeds);

  React.useEffect(() => {
    if (paused) return;
    const engineMap = engines.current;
    if (!engineMap) return;

    const id = window.setInterval(() => {
      const now = Date.now();
      setAssets((prev) =>
        prev.map((asset) => {
          const engine = engineMap[asset.seed.assetId];
          if (!engine) return asset;

          const { state, snapshot } = advanceSimulation(engine.state, engine.rng, now);
          engine.state = state;

          return {
            ...asset,
            snapshot,
            history: [...asset.history, snapshot.point].slice(-HISTORY_LIMIT),
            alerts: detectAlerts(
              asset.alerts,
              asset.snapshot,
              snapshot,
              asset.seed.assetId,
            ),
          };
        }),
      );
      setTick((value) => value + 1);
    }, intervalMs);

    return () => window.clearInterval(id);
  }, [paused, intervalMs]);

  const reset = React.useCallback(() => {
    engines.current = buildEngines(seeds);
    setAssets(initialState(seeds));
    setTick(0);
  }, [seeds]);

  return { assets, tick, paused, setPaused, reset, intervalMs };
}
