import { RadioIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { MonitoringBoard } from "@/features/monitoring/components/monitoring-board";
import { getMonitoringSeeds } from "@/features/monitoring/queries";

export const metadata = { title: "Live monitoring" };

export default async function MonitoringPage() {
  const seeds = await getMonitoringSeeds();
  const withTelemetry = seeds.filter((seed) => seed.lastRecordedAt !== null).length;

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <RadioIcon className="size-5 text-muted-foreground" />
            <h1 className="text-xl font-semibold tracking-tight">
              Live plant monitoring
            </h1>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            A streaming view of every asset&apos;s process signals with the AI4I
            guardrail rules evaluated on each tick. The feed is{" "}
            <strong className="font-medium text-foreground">simulated</strong>{" "}
            from stored readings — it is not connected to plant hardware.
          </p>
        </div>
        <Badge variant="outline">
          {seeds.length} assets · {withTelemetry} with stored telemetry
        </Badge>
      </header>

      <MonitoringBoard seeds={seeds} />
    </div>
  );
}
