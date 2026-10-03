import { tool, zodSchema } from "ai";
import { z } from "zod";

import {
  buildKeywordSearchQuery,
  buildVectorSearchQuery,
  embedQuery,
} from "@/features/ingestion/retrieval.ts";
import { CHUNK_DISPLAY_CHARS, clampCount, SEARCH_TOOL_DEFAULT_TOP_K, SEARCH_TOOL_MAX_TOP_K } from "../limits.ts";
import { withToolBoundary } from "../boundary.ts";
import type { ToolRuntime } from "../runtime.ts";
import { fail, ok } from "../types.ts";

/**
 * searchDocumentsVector + searchDocumentsKeyword.
 *
 * Both retrieve with the exact-scan builders from
 * `features/ingestion/retrieval.ts` — the same SQL the Phase 3 pipeline
 * verified — so the agent and the evaluation measure the same retrieval. The
 * vector path pins `embedModel` to the active provider (a run must never mix
 * embedding spaces); the keyword path is embedding-independent and
 * intentionally not pinned.
 */

type RawChunkRow = {
  id: string;
  ordinal: number;
  content: string;
  title: string;
  docType: string;
  sourceKey: string;
  isSynthetic: boolean;
  distance?: number;
  rank?: number;
};

function truncateContent(content: string): string {
  return content.length <= CHUNK_DISPLAY_CHARS
    ? content
    : `${content.slice(0, CHUNK_DISPLAY_CHARS)}... [truncated]`;
}

function toHit(row: RawChunkRow) {
  return {
    id: row.id,
    ordinal: row.ordinal,
    documentTitle: row.title,
    docType: row.docType,
    sourceKey: row.sourceKey,
    content: truncateContent(row.content),
    score: row.distance ?? row.rank ?? 0,
  };
}

const retriableInput = zodSchema(z.object({
  query: z.string().min(1).describe("What to search for, in the user's words or terms."),
  assetName: z
    .string()
    .optional()
    .describe('Scope the search to one asset when the question concerns one machine, e.g. "PUMP-101".'),
  topK: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Number of chunks to return. Defaults to 5, capped at 10."),
}));
type RetriableInput = { query: string; assetName?: string; topK?: number };

/** Resolve an optional asset name to its id, mapping unknowns to NOT_FOUND. */
async function resolveOptionalAsset(
  runtime: ToolRuntime,
  assetName: string | undefined,
): Promise<{ ok: true; assetId?: string } | { ok: false; error: { code: "NOT_FOUND"; message: string } }> {
  if (!assetName) return { ok: true };
  const assetId = await runtime.db.resolveAssetId(assetName);
  if (assetId === null) {
    return { ok: false, error: { code: "NOT_FOUND", message: `Unknown asset "${assetName}".` } };
  }
  return { ok: true, assetId };
}

export function defineSearchDocumentsVectorTool(runtime: ToolRuntime) {
  return tool({
    description:
      "Semantic search over the asset document corpus (operating manuals, standard operating procedures, fault narratives, inspection reports). Use when the answer depends on documented procedure, limits, or narrative text. Returns up to topK most similar chunks with chunk ids the answer may cite.",
    inputSchema: retriableInput,
    execute: withToolBoundary("searchDocumentsVector", runtime, async (input: RetriableInput) => {
      const query = input.query.trim();
      if (!query) return fail("INVALID_INPUT", "Query must not be empty.");

      const resolved = await resolveOptionalAsset(runtime, input.assetName);
      if (!resolved.ok) return resolved;
      const assetId = resolved.assetId;

      const topK = clampCount(input.topK, SEARCH_TOOL_DEFAULT_TOP_K, SEARCH_TOOL_MAX_TOP_K);

      try {
        // The query vector goes through the same normalisation and rounding as
        // the stored vectors (embedQuery), and the SQL pins the stored model,
        // so a comparable distance between two different embedding spaces is
        // impossible by construction.
        const queryVector = await embedQuery(query, runtime.embed);
        const { sql, params } = buildVectorSearchQuery({
          queryVector,
          topK,
          assetId,
          embedModel: runtime.embed.id,
        });
        const rows = await runtime.db.rawQuery<RawChunkRow>(sql, params);
        const hits = rows.map(toHit);

        runtime.recordEvidence(hits.map((h) => ({ kind: "chunk", id: h.id, ordinal: h.ordinal })));

        return ok({
          query,
          assetName: input.assetName ?? null,
          count: hits.length,
          embedModel: runtime.embed.id,
          hits: hits.map(({ score, ...h }) => ({ ...h, distance: score })),
        });
      } catch (err) {
        return fail(
          "UPSTREAM",
          `Vector search failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),
  });
}

export function defineSearchDocumentsKeywordTool(runtime: ToolRuntime) {
  return tool({
    description:
      "Exact keyword search over the same document corpus, backed by the full-text (tsvector) index. Use when you know the exact term — a procedure name, a documented limit, an inspection milestone. Returns up to topK matching chunks ranked by relevance.",
    inputSchema: retriableInput,
    execute: withToolBoundary("searchDocumentsKeyword", runtime, async (input: RetriableInput) => {
      const query = input.query.trim();
      if (!query) return fail("INVALID_INPUT", "Query must not be empty.");

      const resolved = await resolveOptionalAsset(runtime, input.assetName);
      if (!resolved.ok) return resolved;
      const assetId = resolved.assetId;

      const topK = clampCount(input.topK, SEARCH_TOOL_DEFAULT_TOP_K, SEARCH_TOOL_MAX_TOP_K);

      try {
        const { sql, params } = buildKeywordSearchQuery({
          query,
          topK,
          assetId,
        });
        const rows = await runtime.db.rawQuery<RawChunkRow>(sql, params);
        const hits = rows.map(toHit);

        runtime.recordEvidence(hits.map((h) => ({ kind: "chunk", id: h.id, ordinal: h.ordinal })));

        return ok({
          query,
          assetName: input.assetName ?? null,
          count: hits.length,
          hits: hits.map(({ score, ...h }) => ({ ...h, rank: score })),
        });
      } catch (err) {
        return fail(
          "UPSTREAM",
          `Keyword search failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),
  });
}