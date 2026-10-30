import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export type TelemetryTone = "ok" | "warn" | "bad" | "muted";

const VALUE_TONE: Record<TelemetryTone, string> = {
  ok: "text-foreground",
  warn: "text-amber-600 dark:text-amber-400",
  bad: "text-destructive",
  muted: "text-muted-foreground",
};

const BORDER_TONE: Record<TelemetryTone, string> = {
  ok: "border-border",
  warn: "border-amber-500/40",
  bad: "border-destructive/50",
  muted: "border-border",
};

export function TelemetryTile({
  label,
  value,
  unit,
  hint,
  icon: Icon,
  tone = "ok",
}: {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  icon?: LucideIcon;
  tone?: TelemetryTone;
}) {
  return (
    <div className={cn("rounded-lg border bg-card p-3", BORDER_TONE[tone])}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        {Icon ? <Icon className={cn("size-3.5", VALUE_TONE[tone])} /> : null}
      </div>
      <p className={cn("mt-1 font-mono text-xl tabular-nums", VALUE_TONE[tone])}>
        {value}
        {unit ? <span className="ml-1 text-xs font-sans text-muted-foreground">{unit}</span> : null}
      </p>
      {hint ? <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
