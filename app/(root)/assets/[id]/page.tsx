import Link from "next/link";
import { notFound } from "next/navigation";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/features/assets/components/badges";
import { StatCard } from "@/features/assets/components/stat-card";
import {
  ComponentList,
  FaultList,
  MaintenanceList,
  ReadingsTable,
} from "@/features/assets/components/asset-panels";
import {
  getAssetDetail,
  getFaults,
  getMaintenance,
  getRecentReadings,
} from "@/features/assets/queries";
import {
  MODE_LABEL,
  formatDate,
  formatDateTime,
  formatInteger,
  formatKelvinAsCelsius,
  formatNumber,
} from "@/features/assets/utils/format";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const asset = await getAssetDetail(id);
  return { title: asset ? `${asset.name} · ${asset.model}` : "Asset" };
}

export default async function AssetDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ fc?: string; fi?: string; mc?: string; mi?: string }>;
}) {
  const { id } = await params;
  const { fc, fi, mc, mi } = await searchParams;

  const [asset, faults, maintenance, readings] = await Promise.all([
    getAssetDetail(id),
    getFaults({
      assetId: id,
      cursor: fc ? { occurredAt: fc, id: fi ?? "" } : undefined,
    }),
    getMaintenance({
      assetId: id,
      cursor: mc ? { performedAt: mc, id: mi ?? "" } : undefined,
    }),
    getRecentReadings(id, 12),
  ]);

  if (!asset) notFound();

  const avg = asset.aggregates._avg;
  const failureRate =
    asset._count.sensorReadings === 0
      ? 0
      : asset._count.faultRecords / asset._count.sensorReadings;

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{asset.name}</h1>
            <StatusBadge status={asset.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {asset.manufacturer} {asset.model} · serial {asset.serialNumber}
            {asset.site ? ` · ${asset.site}` : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            Installed {formatDate(asset.installedAt)} ·{" "}
            {formatInteger(asset._count.documents)} documents indexed
          </p>
        </div>
        <Link href="/" className="text-sm underline-offset-4 hover:underline">
          ← Fleet dashboard
        </Link>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Readings"
          value={formatInteger(asset._count.sensorReadings)}
          hint={`Last ${formatDateTime(asset.lastReadingAt)}`}
        />
        <StatCard
          title="Faults"
          value={formatInteger(asset._count.faultRecords)}
          hint={`${(failureRate * 100).toFixed(2)}% of readings`}
        />
        <StatCard
          title="Mean air temp"
          value={avg.airTempK === null ? "—" : formatKelvinAsCelsius(avg.airTempK)}
          hint={avg.processTempK === null ? undefined : `Process ${formatKelvinAsCelsius(avg.processTempK)}`}
        />
        <StatCard
          title="Peak tool wear"
          value={formatNumber(asset.aggregates._max.toolWearMin, 0) + " min"}
          hint={
            avg.torqueNm === null
              ? undefined
              : `Mean torque ${formatNumber(avg.torqueNm)} Nm`
          }
        />
      </section>

      {asset.modeCounts.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Failure mode distribution</CardTitle>
            <CardDescription>
              Dataset ground-truth labels for this asset.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-wrap gap-2">
              {asset.modeCounts.map((m) => (
                <li
                  key={m.mode}
                  className="flex items-center gap-2 rounded-lg border px-3 py-1.5"
                >
                  <span className="font-mono text-xs text-muted-foreground">
                    {m.mode}
                  </span>
                  <span className="text-sm">{MODE_LABEL[m.mode] ?? m.mode}</span>
                  <span className="font-medium tabular-nums">{m.count}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Fault history</CardTitle>
            <CardDescription>
              Keyset-paginated on (occurredAt, id) so concurrent inserts cannot
              skip rows.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FaultList faults={faults.rows} />
            {faults.nextCursor ? (
              <>
                <Separator className="my-4" />
                <a
                  href={`/assets/${asset.id}?fc=${encodeURIComponent(faults.nextCursor.occurredAt)}&fi=${encodeURIComponent(faults.nextCursor.id)}`}
                  className="text-sm underline-offset-4 hover:underline"
                >
                  Older faults →
                </a>
              </>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Maintenance log</CardTitle>
            <CardDescription>Scheduled and corrective work.</CardDescription>
          </CardHeader>
          <CardContent>
            <MaintenanceList logs={maintenance.rows} />
            {maintenance.nextCursor ? (
              <>
                <Separator className="my-4" />
                <a
                  href={`/assets/${asset.id}?mc=${encodeURIComponent(maintenance.nextCursor.performedAt)}&mi=${encodeURIComponent(maintenance.nextCursor.id)}`}
                  className="text-sm underline-offset-4 hover:underline"
                >
                  Older entries →
                </a>
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <ComponentList components={asset.components} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent sensor readings</CardTitle>
          <CardDescription>
            Stored in Kelvin, displayed in Celsius. ΔT is the process-minus-air
            differential the heat-dissipation guardrail evaluates.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <ReadingsTable readings={readings} />
        </CardContent>
      </Card>
    </div>
  );
}
