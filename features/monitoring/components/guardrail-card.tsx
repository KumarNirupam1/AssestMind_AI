import { AlertTriangleIcon, CircleCheckIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { GuardrailVerdict } from "@/features/guardrails/rules";
import { cn } from "@/lib/utils";

export function GuardrailCard({
  verdict,
  description,
}: {
  verdict: GuardrailVerdict;
  description: string;
}) {
  const triggered = verdict.triggered;

  return (
    <Card
      className={cn(
        "transition-colors",
        triggered ? "border-destructive/50" : "border-emerald-500/30",
      )}
    >
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <div>
          <CardTitle className="font-mono text-sm">{verdict.mode}</CardTitle>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "font-medium",
            triggered
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
          )}
        >
          {triggered ? "Breach" : "Clear"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-2">
        <ul className="space-y-1">
          {verdict.clauses.map((clause) => (
            <li key={clause.name} className="flex items-start gap-2 text-[11px]">
              {clause.met ? (
                <CircleCheckIcon className="mt-0.5 size-3 shrink-0 text-emerald-500" />
              ) : (
                <AlertTriangleIcon className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
              )}
              <span className="text-muted-foreground">{clause.detail}</span>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-muted-foreground">{verdict.reason}</p>
      </CardContent>
    </Card>
  );
}
