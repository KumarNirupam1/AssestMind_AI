"use client";

import {
  AlertTriangleIcon,
  CircleCheckIcon,
  PauseIcon,
  PlayIcon,
  RadioIcon,
  RotateCcwIcon,
  ThermometerIcon,
  WrenchIcon,
  ZapIcon,
} from "lucide-react";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatusBadge } from "@/features/assets/components/badges";
import {
  MODE_DESCRIPTION,
  formatInteger,
  formatNumber,
  kelvinToCelsius,
} from "@/features/assets/utils/format";
import {
  AI4I_THRESHOLDS,
  GUARDRAIL_MODES,
  mechanicalPowerW,
} from "@/features/guardrails/rules";
import { GuardrailCard } from "@/features/monitoring/components/guardrail-card";
import { Sparkline } from "@/features/monitoring/components/sparkline";
import { TelemetryTile } from "@/features/monitoring/components/telemetry-tile";
import { type MonitoringSeed } from "@/features/monitoring/simulation";
import { useLiveTelemetry } from "@/features/monitoring/use-live-telemetry";
import { cn } from "@/lib/utils";

function localTime(at: number): string {
  return at > 0 ? new Date(at).toLocaleTimeString("en-GB") : "—";
}

export function MonitoringBoard({ seeds }: { seeds: MonitoringSeed[] }) {
  const { assets, tick, paused, setPaused, reset, intervalMs } = useLiveTelemetry(seeds);
  const [selectedId, setSelectedId] = React.useState<string | null>(
    seeds[0]?.assetId ?? null,
  );

  if (assets.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">No assets to monitor</CardTitle>
          <CardDescription>
            Seed the database (`npm run db:seed`) to populate assets and sensor
            readings, then reload this page.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const selected = assets.find((a) => a.seed.assetId === selectedId) ?? assets[0];
  if (!selected) return null;

  const snapshot = selected.snapshot;
  const point = snapshot.point;
  const verdictByMode = new Map(
    snapshot.evaluation.verdicts.map((verdict) => [verdict.mode, verdict]),
  );
  const hdf = verdictByMode.get("HDF");
  const pwf = verdictByMode.get("PWF");
  const osf = verdictByMode.get("OSF");

  const osfLimit = AI4I_THRESHOLDS.osf.limitByType[selected.seed.productType];
  const tempDeltaSeries = selected.history.map(
    (p) => Math.abs(p.processTempK - p.airTempK),
  );
  const powerSeries = selected.history.map((p) => mechanicalPowerW(p));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="gap-1">
            <RadioIcon className="size-3" />
            Simulated feed
          </Badge>
          <span className="text-xs text-muted-foreground">
            Seeded from stored readings · one tick every{" "}
            {(intervalMs / 1000).toFixed(1)}s · no writes
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs tabular-nums text-muted-foreground">
            {tick === 0 ? "waiting for first tick" : `${tick} ticks`}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPaused((value) => !value)}
          >
            {paused ? <PlayIcon /> : <PauseIcon />}
            {paused ? "Resume" : "Pause"}
          </Button>
          <Button variant="ghost" size="sm" onClick={reset}>
            <RotateCcwIcon />
            Reset
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <Card className="h-fit">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Plant assets</CardTitle>
            <CardDescription>{assets.length} monitored</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            {assets.map((asset) => {
              const triggered = asset.snapshot.evaluation.triggeredModes;
              const isSelected = asset.seed.assetId === selected.seed.assetId;
              return (
                <button
                  key={asset.seed.assetId}
                  type="button"
                  onClick={() => setSelectedId(asset.seed.assetId)}
                  className={cn(
                    "w-full rounded-md border px-2.5 py-2 text-left text-sm transition-colors",
                    isSelected
                      ? "border-ring bg-muted"
                      : "border-transparent hover:bg-muted/60",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{asset.seed.name}</span>
                    <span
                      className={cn(
                        "size-2 shrink-0 rounded-full",
                        triggered.length > 0
                          ? "animate-pulse bg-destructive"
                          : "bg-emerald-500",
                      )}
                    />
                  </div>
                  <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                    <span className="truncate">{asset.seed.model}</span>
                    {triggered.length > 0 ? (
                      <span className="ml-auto flex gap-1">
                        {triggered.map((mode) => (
                          <Badge
                            key={mode}
                            variant="outline"
                            className="border-destructive/40 px-1 py-0 font-mono text-[9px] text-destructive"
                          >
                            {mode}
                          </Badge>
                        ))}
                      </span>
                    ) : (
                      <span className="ml-auto tabular-nums">
                        {formatInteger(asset.snapshot.powerW)} W
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 pb-3">
              <div>
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  {selected.seed.name}
                  <StatusBadge status={selected.seed.status} />
                  <Badge
                    variant="outline"
                    className={cn(
                      "font-mono text-[10px]",
                      snapshot.scenario === "NORMAL"
                        ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-400"
                        : "border-destructive/40 text-destructive",
                    )}
                  >
                    {snapshot.scenario === "NORMAL"
                      ? "nominal"
                      : `excursion · ${snapshot.scenario}`}
                  </Badge>
                </CardTitle>
                <CardDescription>
                  {selected.seed.model}
                  {selected.seed.site ? ` · ${selected.seed.site}` : ""} · product{" "}
                  {selected.seed.productType}
                </CardDescription>
              </div>
              <div className="text-right text-xs text-muted-foreground">
                <p>
                  {paused ? "paused" : "live"} · tick {tick}
                </p>
                <p className="tabular-nums">{localTime(point.at)}</p>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                <TelemetryTile
                  label="Air temp"
                  value={kelvinToCelsius(point.airTempK).toFixed(1)}
                  unit="°C"
                  icon={ThermometerIcon}
                />
                <TelemetryTile
                  label="Process temp"
                  value={kelvinToCelsius(point.processTempK).toFixed(1)}
                  unit="°C"
                  icon={ThermometerIcon}
                />
                <TelemetryTile
                  label="Temp delta"
                  value={formatNumber(snapshot.tempDeltaK, 1)}
                  unit="K"
                  hint="HDF limit < 8.6 K"
                  icon={ThermometerIcon}
                  tone={
                    hdf?.triggered
                      ? "bad"
                      : snapshot.tempDeltaK < 8.6
                        ? "warn"
                        : "ok"
                  }
                />
                <TelemetryTile
                  label="Speed"
                  value={formatInteger(point.rotationalSpeedRpm)}
                  unit="rpm"
                  hint="HDF limit < 1380 rpm"
                  icon={ZapIcon}
                  tone={point.rotationalSpeedRpm < 1380 ? "warn" : "ok"}
                />
                <TelemetryTile
                  label="Torque"
                  value={formatNumber(point.torqueNm, 1)}
                  unit="Nm"
                  icon={WrenchIcon}
                />
                <TelemetryTile
                  label="Tool wear"
                  value={formatNumber(point.toolWearMin, 0)}
                  unit="min"
                  hint="replace at 240 min"
                  icon={WrenchIcon}
                  tone={osf?.triggered ? "bad" : "ok"}
                />
                <TelemetryTile
                  label="Mech. power"
                  value={formatInteger(snapshot.powerW)}
                  unit="W"
                  hint="band 3500–9000 W"
                  icon={ZapIcon}
                  tone={pwf?.triggered ? "bad" : "ok"}
                />
                <TelemetryTile
                  label="OSF load"
                  value={formatInteger(snapshot.osfLoad)}
                  unit="min·Nm"
                  hint={`limit ${osfLimit} (${selected.seed.productType})`}
                  icon={AlertTriangleIcon}
                  tone={osf?.triggered ? "bad" : "ok"}
                />
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-lg border p-3">
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-medium">Temperature delta</span>
                    <span className="text-muted-foreground">
                      {formatNumber(snapshot.tempDeltaK, 2)} K
                    </span>
                  </div>
                  <div
                    className={cn(
                      hdf?.triggered ? "text-destructive" : "text-sky-500",
                    )}
                  >
                    <Sparkline
                      values={tempDeltaSeries}
                      ariaLabel="Process minus air temperature trend"
                    />
                  </div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-medium">Mechanical power</span>
                    <span className="text-muted-foreground">
                      {formatInteger(snapshot.powerW)} W
                    </span>
                  </div>
                  <div
                    className={cn(
                      pwf?.triggered ? "text-destructive" : "text-amber-500",
                    )}
                  >
                    <Sparkline
                      values={powerSeries}
                      ariaLabel="Mechanical power trend"
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <div>
            <h3 className="mb-2 text-sm font-medium">Guardrail evaluation</h3>
            <div className="grid gap-2 md:grid-cols-3">
              {GUARDRAIL_MODES.map((mode) => {
                const verdict = verdictByMode.get(mode);
                return verdict ? (
                  <GuardrailCard
                    key={mode}
                    verdict={verdict}
                    description={MODE_DESCRIPTION[mode]}
                  />
                ) : null;
              })}
            </div>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <AlertTriangleIcon className="size-4 text-amber-500" />
                Alert feed
              </CardTitle>
              <CardDescription>
                Rising-edge guardrail breaches in this session
              </CardDescription>
            </CardHeader>
            <CardContent>
              {selected.alerts.length === 0 ? (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <CircleCheckIcon className="size-3.5 text-emerald-500" />
                  All clear — no guardrail breaches yet.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {selected.alerts.map((alert) => (
                    <li
                      key={alert.id}
                      className="flex items-start gap-2 text-xs"
                    >
                      <Badge
                        variant="outline"
                        className="shrink-0 border-destructive/40 font-mono text-[10px] text-destructive"
                      >
                        {alert.mode}
                      </Badge>
                      <span className="text-muted-foreground">{alert.reason}</span>
                      <span className="ml-auto shrink-0 tabular-nums text-[10px] text-muted-foreground">
                        {localTime(alert.at)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
