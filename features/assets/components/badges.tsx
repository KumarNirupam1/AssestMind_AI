import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { MODE_DESCRIPTION, SEVERITY_LABEL, STATUS_LABEL } from "@/features/assets/utils/format";

const SEVERITY_CLASS: Record<string, string> = {
  LOW: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  MEDIUM: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  HIGH: "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-400",
  CRITICAL: "border-destructive/40 bg-destructive/10 text-destructive",
};

const STATUS_CLASS: Record<string, string> = {
  OPERATIONAL: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  DEGRADED: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  MAINTENANCE: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400",
  DOWN: "border-destructive/40 bg-destructive/10 text-destructive",
};

export function SeverityBadge({ severity }: { severity: string }) {
  return (
    <Badge variant="outline" className={cn("font-medium", SEVERITY_CLASS[severity])}>
      {SEVERITY_LABEL[severity] ?? severity}
    </Badge>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={cn("font-medium", STATUS_CLASS[status])}>
      {STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

export function ModeBadge({ mode }: { mode: string }) {
  return (
    <Badge variant="secondary" className="font-mono text-[10px]" title={MODE_DESCRIPTION[mode]}>
      {mode}
    </Badge>
  );
}

export function CriticalityBadge({ criticality }: { criticality: string }) {
  return (
    <Badge variant="outline" className={cn("font-medium", SEVERITY_CLASS[criticality])}>
      {SEVERITY_LABEL[criticality] ?? criticality}
    </Badge>
  );
}
