import {
  ActivityIcon,
  AlertTriangleIcon,
  FactoryIcon,
  GaugeIcon,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { AssetHealthTable } from "@/features/assets/components/asset-health-table";
import { StatCard } from "@/features/assets/components/stat-card";
import { getAssetHealth, getFleetSummary } from "@/features/assets/queries";
import {
  MODE_LABEL,
  formatDateTime,
  formatInteger,
  formatPercent,
} from "@/features/assets/utils/format";

export const metadata = { title: "Fleet dashboard" };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { cursor } = await searchParams;
  const [summary, page] = await Promise.all([
    getFleetSummary(),
    getAssetHealth({ cursor }),
  ]);

  const modeEntries = Object.entries(summary.byMode).sort(
    (a, b) => b[1] - a[1],
  );

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Fleet dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Synthetic machining-centre fleet seeded from the AI4I 2020 dataset.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          Latest reading {formatDateTime(summary.lastRecordedAt)}
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Assets"
          value={formatInteger(summary.assets)}
          hint="Synthetic machining centres"
          icon={FactoryIcon}
        />
        <StatCard
          title="Sensor readings"
          value={formatInteger(summary.totalReadings)}
          hint="AI4I 2020 rows, 1 per UDI"
          icon={ActivityIcon}
        />
        <StatCard
          title="Labelled faults"
          value={formatInteger(summary.totalFaults)}
          hint={`${formatPercent(summary.faultRate)} of readings`}
          icon={GaugeIcon}
          tone={summary.totalFaults > 0 ? "warning" : "default"}
        />
        <StatCard
          title="Unresolved"
          value={formatInteger(summary.unresolved)}
          hint="Awaiting corrective action"
          icon={AlertTriangleIcon}
          tone={summary.unresolved > 0 ? "danger" : "default"}
        />
      </section>

      {modeEntries.length > 0 ? (
        <section className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Asset health</CardTitle>
              <CardDescription>
                Aggregates computed directly from sensor readings and fault
                records. Read path is Server Components over Prisma — no internal
                API hop.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <AssetHealthTable rows={page.rows} />
            </CardContent>
            {page.nextCursor ? (
              <>
                <Separator />
                <CardContent className="flex justify-end pt-4">
                  <a
                    href={`/?cursor=${encodeURIComponent(page.nextCursor)}`}
                    className="text-sm font-medium underline-offset-4 hover:underline"
                  >
                    Next page →
                  </a>
                </CardContent>
              </>
            ) : null}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Fault modes</CardTitle>
              <CardDescription>
                Counts come from the dataset&apos;s own per-mode ground-truth
                columns, not from a rule evaluation.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {modeEntries.map(([mode, count]) => (
                  <li
                    key={mode}
                    className="flex items-center justify-between rounded-lg border px-3 py-2"
                  >
                    <span className="text-sm">
                      <span className="font-mono text-xs text-muted-foreground">
                        {mode}
                      </span>{" "}
                      {MODE_LABEL[mode] ?? mode}
                    </span>
                    <span className="font-medium tabular-nums">
                      {formatInteger(count)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-xs text-muted-foreground">
                The Phase 2 guardrail engine is validated against these labels; it
                is never their source. 9 labelled failures in the source dataset
                carry no mode flag and are stored as readings only.
              </p>
            </CardContent>
          </Card>
        </section>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>No data</CardTitle>
            <CardDescription>
              Run <code>npx prisma db seed</code> to load the AI4I dataset.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}
