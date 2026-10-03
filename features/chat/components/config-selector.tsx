"use client";

import { CONFIG_LABELS, CONFIG_OPTIONS, configToolCount } from "@/features/chat/config";
import type { ToolConfigKey } from "@/features/evaluation/question-set.ts";

/**
 * Tool-config switcher for a conversation. Config membership stays defined in
 * `TOOL_CONFIGS_FROZEN` (shared with the eval harness) — this only renders it.
 */
export function ConfigSelector({
  value,
  onChange,
}: {
  value: ToolConfigKey;
  onChange: (next: ToolConfigKey) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-muted-foreground">
      <span className="hidden sm:inline">Tool config</span>
      <select
        value={value}
        onChange={(event) => onChange(Number(event.target.value) as ToolConfigKey)}
        className="rounded-md border border-border bg-background px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {CONFIG_OPTIONS.map((key) => (
          <option key={key} value={key}>
            {key} — {CONFIG_LABELS[key]} ({configToolCount(key)} tools)
          </option>
        ))}
      </select>
    </label>
  );
}