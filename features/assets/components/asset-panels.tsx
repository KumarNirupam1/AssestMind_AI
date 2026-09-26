import { CircleCheckIcon, CircleDotIcon } from "lucide-react";

import { ModeBadge, SeverityBadge, CriticalityBadge } from "@/features/assets/components/badges";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { FaultPage } from "@/features/assets/queries";
import {
  CRITICALITY_LABEL,
  MAINTENANCE_TYPE_LABEL,
  MODE_LABEL,
  formatDateTime,
  formatKelvinAsCelsius,
  formatNumber,
} from "@/features/assets/utils/format";

export function FaultList({ faults }: { faults: FaultPage[] }) {
  if (faults.length === 0) {
    return <p className="text-sm text-muted-foreground">No faults recorded.</p>;
  }

  return (
    <ol className="space-y-3">
      {faults.map((fault) => (
        <li key={fault.id} className="rounded-lg border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <ModeBadge mode={fault.mode} />
            <span className="text-sm font-medium">{MODE_LABEL[fault.mode] ?? fault.mode}</span>
            <SeverityBadge severity={fault.severity} />
            <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
              {fault.resolvedAt ? (
                <>
                  <CircleCheckIcon className="size-3.5 text-emerald-500" />
                  resolved {formatDateTime(fault.resolvedAt)}
                </>
              ) : (
                <>
                  <CircleDotIcon className="size-3.5 text-destructive" />
                  unresolved
                </>
              )}
            </span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{fault.description}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Occurred {formatDateTime(fault.occurredAt)}
            {fault.sensorReadingId ? (
              <>
                {" · dataset reading "}
                <span className="font-mono">UDI {fault.sensorReadingId}</span>
              </>
            ) : null}
          </p>
        </li>
      ))}
    </ol>
  );
}

export function MaintenanceList({
  logs,
}: {
  logs: {
    id: string;
    type: string;
    description: string;
    performedAt: Date;
    technician: string | null;
  }[];
}) {
  if (logs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No maintenance recorded.</p>
    );
  }

  return (
    <ol className="space-y-2">
      {logs.map((log) => (
        <li key={log.id} className="flex items-start gap-3 rounded-lg border p-3">
          <span className="mt-0.5 rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium">
            {MAINTENANCE_TYPE_LABEL[log.type] ?? log.type}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm">{log.description}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatDateTime(log.performedAt)}
              {log.technician ? ` · ${log.technician}` : ""}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function ReadingsTable({
  readings,
}: {
  readings: {
    id: string;
    recordedAt: Date;
    airTempK: number;
    processTempK: number;
    rotationalSpeedRpm: number;
    torqueNm: number;
    toolWearMin: number;
    qualityVariant: string;
    machineFailure: boolean;
  }[];
}) {
  if (readings.length === 0) {
    return <p className="text-sm text-muted-foreground">No readings recorded.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Recorded</TableHead>
          <TableHead className="text-right">UDI</TableHead>
          <TableHead className="text-right">Air temp</TableHead>
          <TableHead className="text-right">Process temp</TableHead>
          <TableHead className="text-right">ΔT</TableHead>
          <TableHead className="text-right">Speed</TableHead>
          <TableHead className="text-right">Torque</TableHead>
          <TableHead className="text-right">Wear</TableHead>
          <TableHead>Variant</TableHead>
          <TableHead>Outcome</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {readings.map((r) => {
          const delta = r.processTempK - r.airTempK;
          return (
            <TableRow key={r.id}>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {formatDateTime(r.recordedAt)}
              </TableCell>
              <TableCell className="text-right font-mono text-xs">
                {r.id}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatKelvinAsCelsius(r.airTempK)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatKelvinAsCelsius(r.processTempK)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {delta.toFixed(2)} K
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatNumber(r.rotationalSpeedRpm, 0)} rpm
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatNumber(r.torqueNm)} Nm
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatNumber(r.toolWearMin, 0)} min
              </TableCell>
              <TableCell>{r.qualityVariant}</TableCell>
              <TableCell>
                {r.machineFailure ? (
                  <span className="font-medium text-destructive">failed</span>
                ) : (
                  <span className="text-muted-foreground">ok</span>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export function ComponentList({
  components,
}: {
  components: { id: string; name: string; type: string; criticality: string }[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Components</CardTitle>
        <CardDescription>
          Sub-assemblies tracked for this asset.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-2 sm:grid-cols-2">
          {components.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{c.name}</p>
                <p className="font-mono text-[11px] text-muted-foreground">{c.type}</p>
              </div>
              <CriticalityBadge criticality={c.criticality} />
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">
          Criticality scale: {Object.values(CRITICALITY_LABEL).join(" · ")}
        </p>
      </CardContent>
    </Card>
  );
}
