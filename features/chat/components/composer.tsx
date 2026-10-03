"use client";

import { ArrowUpIcon } from "lucide-react";
import * as React from "react";

/**
 * Input bar pinned at the bottom of a conversation. Enter sends, Shift+Enter
 * inserts a newline; the button and textarea both gate on empty input and the
 * in-flight status.
 */
export function Composer({
  onSend,
  disabled,
}: {
  onSend: (text: string) => void;
  disabled: boolean;
}) {
  const [value, setValue] = React.useState("");

  const submit = () => {
    const trimmed = value.trim();
    if (trimmed.length === 0 || disabled) return;
    onSend(trimmed);
    setValue("");
  };

  return (
    <div className="shrink-0 border-t px-6 py-3">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="mx-auto flex w-full max-w-3xl items-end gap-2"
      >
        <textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          rows={1}
          autoFocus
          placeholder="Ask about an asset, fault, or maintenance record…"
          aria-label="Investigation prompt"
          className="max-h-40 min-h-10 flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={disabled || value.trim().length === 0}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
        >
          <ArrowUpIcon className="size-4" />
          Send
        </button>
      </form>
      <p className="mx-auto mt-1.5 max-w-3xl text-center text-[11px] text-muted-foreground">
        Answers cite their sources ({`[chunk:…]`}, {`[fault:…]`}, {`[guardrail:…]`}) — each is
        machine-checkable against the logged tool trace.
      </p>
    </div>
  );
}