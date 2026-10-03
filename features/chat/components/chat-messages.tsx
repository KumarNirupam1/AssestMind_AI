"use client";

import { isTextUIPart, type UIMessage } from "ai";
import { CheckCircle2Icon, Loader2Icon, SlidersHorizontalIcon, XCircleIcon } from "lucide-react";
import * as React from "react";

import type { EvidenceEntry } from "@/features/evaluation/run-manifest.ts";
import type { EvidenceLedger } from "@/features/chat/queries";
import { splitCitations } from "@/features/chat/citations";
import { cn } from "@/lib/utils";

/**
 * Message list for the investigation chat.
 *
 * Tool parts arrive live over the stream (the `tool-…` UIPart instances),
 * so tool cards render as the agent works. Tool parts are *not* persisted —
 * DB rows keep only role + text + evidence — so on reload the trace is
 * reconstructed from the evidence ledger instead.
 */

const TOOL_LABELS: Record<string, string> = {
  searchDocumentsVector: "Vector search",
  searchDocumentsKeyword: "Keyword search",
  getAssetContext: "Asset context",
  getFaultHistory: "Fault history",
  getMaintenanceHistory: "Maintenance history",
  checkGuardrails: "Guardrail check",
};

function messageText(message: UIMessage): string {
  return message.parts.filter(isTextUIPart).map((part) => part.text).join("");
}

/** Citation tokens the model is instructed to emit, made clickable chips. */
function CitationText({ text }: { text: string }) {
  return (
    <>
      {splitCitations(text).map((segment, key) =>
        segment.type === "text" ? (
          <React.Fragment key={key}>{segment.text}</React.Fragment>
        ) : (
          <span
            key={key}
            title={`Machine-checkable citation: ${segment.raw}`}
            className={cn(
              "mx-0.5 inline-block rounded border px-1.5 py-px font-mono text-[11px] leading-5 align-baseline",
              segment.token.kind === "guardrail"
                ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                : "border-border bg-muted text-muted-foreground",
            )}
          >
            {segment.raw}
          </span>
        ),
      )}
    </>
  );
}

type ToolPhase =
  | { state: "running" }
  | { state: "done" }
  | { state: "error"; errorText: string };

function toolPartPhase(part: UIMessage["parts"][number]): ToolPhase {
  if (part.type.endsWith("-output-error")) {
    const errorText = (part as { errorText?: string }).errorText;
    return { state: "error", errorText: errorText ?? "Tool call failed" };
  }
  if (part.type.endsWith("-output-ready") || part.type.endsWith("-output-available")) {
    return { state: "done" };
  }
  return { state: "running" };
}

function ToolCards({ message }: { message: UIMessage }) {
  const toolParts = message.parts.filter((part) => part.type.startsWith("tool-"));
  if (toolParts.length === 0) return null;

  return (
    <div className="mt-3 flex flex-col gap-1.5">
      <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        <SlidersHorizontalIcon className="size-3" />
        Agent activity
      </span>
      {toolParts.map((part, index) => {
        const name = part.type.slice(5).split("-")[0];
        const phase = toolPartPhase(part);
        return (
          <div
            key={`${part.type}-${index}`}
            data-slot="tool-card"
            className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-1.5"
          >
            {phase.state === "running" ? (
              <Loader2Icon className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
            ) : phase.state === "error" ? (
              <XCircleIcon className="size-3.5 shrink-0 text-destructive" />
            ) : (
              <CheckCircle2Icon className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-500" />
            )}
            <span className="font-mono text-xs">
              {TOOL_LABELS[name] ?? name}
            </span>
            {phase.state === "error" ? (
              <span className="truncate text-xs text-destructive">— {phase.errorText}</span>
            ) : (
              <span className="text-[11px] text-muted-foreground">
                {phase.state === "running" ? "running" : "complete"}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function EvidencePanel({ evidence }: { evidence: EvidenceEntry[] | undefined }) {
  if (!evidence || evidence.length === 0) return null;
  return (
    <details className="mt-3 rounded-lg border bg-muted/40 text-xs">
      <summary className="cursor-pointer px-3 py-1.5 text-muted-foreground select-none hover:text-foreground">
        Trace — {evidence.length} evidence {evidence.length === 1 ? "entry" : "entries"}
      </summary>
      <ul className="space-y-1 border-t border-border px-3 py-2 font-mono">
        {evidence.map((entry, index) => (
          <li key={index} className="text-muted-foreground">
            {entry.kind === "chunk"
              ? `chunk ${entry.id}#${entry.ordinal}`
              : entry.kind === "fault"
                ? `fault ${entry.id}`
                : `guardrail ${entry.mode}`}
          </li>
        ))}
      </ul>
    </details>
  );
}

function UserBubble({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground whitespace-pre-wrap sm:max-w-[70%]">
        {text}
      </div>
    </div>
  );
}

function AssistantMessage({
  message,
  evidence,
}: {
  message: UIMessage;
  evidence: EvidenceEntry[] | undefined;
}) {
  const text = messageText(message);
  return (
    <div className="flex flex-col">
      <div className="max-w-[92%] whitespace-pre-wrap text-sm sm:max-w-[80%]">
        {text.trim().length > 0 ? <CitationText text={text} /> : null}
        <ToolCards message={message} />
        <EvidencePanel evidence={evidence} />
      </div>
    </div>
  );
}

function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2Icon className="size-4 animate-spin" />
      Thinking…
    </div>
  );
}

export function ChatMessages({
  messages,
  status,
  ledger,
}: {
  messages: UIMessage[];
  status: "submitted" | "streaming" | "ready" | "error";
  ledger: EvidenceLedger;
}) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  return (
    <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-6">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4">
        {messages.map((message) =>
          message.role === "user" ? (
            <UserBubble key={message.id} text={messageText(message)} />
          ) : (
            <AssistantMessage
              key={message.id}
              message={message}
              evidence={ledger.byMessageId[message.id]}
            />
          ),
        )}
        {status === "submitted" ? <ThinkingIndicator /> : null}
      </div>
    </div>
  );
}