import type { EvidenceEntry, ToolCallEntry } from "@/features/evaluation/run-manifest.ts";
import type { EmbeddingProvider } from "@/features/ingestion/embedding.ts";
import { MAX_EVIDENCE_ENTRIES_PER_TURN } from "./limits.ts";
import type { ToolDb } from "./tool-db.ts";

/**
 * ToolRuntime — everything a tool can reach beyond its own input schema.
 *
 * `db` and `embed` are the real services; `recordEvidence` is how a tool
 * declares the citable evidence it surfaced (the model's `[chunk / fault /
 * guardrail]` citations must resolve against what was recorded). The chat
 * route is the only caller that binds these to the database and to the
 * per-user session.
 */
export type ToolRuntime = {
  db: ToolDb;
  embed: EmbeddingProvider;
  recordEvidence: (entries: EvidenceEntry[]) => void;
  /**
   * Called by the execution boundary once per tool call, with the outcome in
   * the FROZEN taxonomy — this is what becomes the run manifest's toolCalls.
   */
  recordToolCall: (entry: ToolCallEntry) => void;
  /** Wall-clock timeout per tool execution, applied by the registry wrapper. */
  timeoutMs?: number;
};

export type TurnCollectors = {
  toolCalls: ToolCallEntry[];
  evidence: EvidenceEntry[];
  recordToolCall: (entry: ToolCallEntry) => void;
  recordEvidence: (entries: EvidenceEntry[]) => void;
};

/**
 * The per-turn accumulation of (a) tool-call records in the FROZEN taxonomy
 * and (b) the evidence the model may cite. `evidence` is capped at
 * `MAX_EVIDENCE_ENTRIES_PER_TURN` and de-duplicated, so a broad question
 * cannot overflow the context window and later evaluations cannot be confused
 * by duplicate citations to the same id.
 */
export function createTurnCollectors(): TurnCollectors {
  const toolCalls: ToolCallEntry[] = [];
  const evidence: EvidenceEntry[] = [];
  const seen = new Set<string>();

  return {
    toolCalls,
    evidence,
    recordToolCall(entry) {
      toolCalls.push(entry);
    },
    recordEvidence(entries) {
      for (const entry of entries) {
        if (evidence.length >= MAX_EVIDENCE_ENTRIES_PER_TURN) return;
        const key =
          entry.kind === "chunk"
            ? `chunk:${entry.id}#${entry.ordinal}`
            : entry.kind === "fault"
              ? `fault:${entry.id}`
              : `guardrail:${entry.mode}`;
        if (seen.has(key)) continue;
        seen.add(key);
        evidence.push(entry);
      }
    },
  };
}