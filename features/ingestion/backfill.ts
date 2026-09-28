import {
  type EmbeddingProvider,
  EMBED_DIM,
  EmbeddingError,
  assertUsableVector,
  toVectorLiteral,
} from "./embedding.ts";

/**
 * Embedding backfill for existing document chunks.
 *
 * The seed creates `DocumentChunk` rows with `embedding = null` and the right
 * `embedModel`/`embedDim` already recorded. This fills them in.
 *
 * Two properties matter more than speed here:
 *
 * 1. **Rerunnable.** Only rows with `embedding IS NULL` are considered, and
 *    each write is keyed by the chunk id, so a second run is a no-op rather
 *    than duplicate work. Nothing creates chunks; `@@unique([documentId,
 *    ordinal])` already anchors identity and the Rerunnable planner refuses to
 *    touch a row whose provenance disagrees with its model metadata.
 * 2. **Provenance untouched.** Only `embedding` is written. `sourceKey`,
 *    `isSynthetic`, `ordinal`, `tokenCount` and `chunkerVersion` are left
 *    alone, because the citation and evidence system in Phase 4 reads them to
 *    turn a `[chunk:<id>#<n>]` citation back into a source.
 */

export type ChunkRow = {
  id: string;
  content: string;
  embedModel: string;
  embedDim: number;
  /** True when `embedding IS NOT NULL`. */
  hasEmbedding: boolean;
};

export type SkipReason =
  | "ALREADY_EMBEDDED"
  | "MODEL_MISMATCH"
  | "DIMENSION_MISMATCH"
  | "EMPTY_CONTENT";

export type BackfillSkip = { id: string; reason: SkipReason; detail: string };

export type BackfillPlan = {
  /** Chunks to embed, in a stable order. */
  embed: ChunkRow[];
  /** Chunks deliberately left alone, with the reason. */
  skip: BackfillSkip[];
};

/**
 * Decide what to embed. Pure, so the rerunnable/idempotent behaviour is
 * testable without a database.
 *
 * A chunk recorded against a different model or dimension is skipped rather
 * than silently re-embedded: overwriting it would rewrite the provenance of a
 * row that other runs may already cite. Re-embedding is a deliberate act and
 * belongs in the re-index script with a documented model bump.
 */
export function planBackfill(
  chunks: ChunkRow[],
  provider: Pick<EmbeddingProvider, "id" | "dimensions">,
): BackfillPlan {
  const embed: ChunkRow[] = [];
  const skip: BackfillSkip[] = [];

  for (const chunk of chunks) {
    if (chunk.hasEmbedding) {
      skip.push({
        id: chunk.id,
        reason: "ALREADY_EMBEDDED",
        detail: "embedding is already populated",
      });
      continue;
    }
    if (chunk.embedModel !== provider.id) {
      skip.push({
        id: chunk.id,
        reason: "MODEL_MISMATCH",
        detail: `chunk recorded ${chunk.embedModel}, active provider is ${provider.id}`,
      });
      continue;
    }
    if (chunk.embedDim !== provider.dimensions) {
      skip.push({
        id: chunk.id,
        reason: "DIMENSION_MISMATCH",
        detail: `chunk recorded ${chunk.embedDim}, active provider emits ${provider.dimensions}`,
      });
      continue;
    }
    if (chunk.content.trim().length === 0) {
      skip.push({
        id: chunk.id,
        reason: "EMPTY_CONTENT",
        detail: "no content to embed",
      });
      continue;
    }
    embed.push(chunk);
  }

  return { embed, skip };
}

export type BackfillResult = {
  embedded: number;
  skipped: BackfillSkip[];
  /** Chunks still awaiting an embedding after this run. */
  remaining: number;
};

/**
 * Dependencies, injected so the backfill is testable without Postgres.
 *
 * `writeEmbedding` receives an already-formatted pgvector literal. Prisma
 * cannot model a `vector` column, so this must be raw SQL — but the *decision*
 * of what to write lives in the tested planner above, not in the SQL string.
 */
export type BackfillDeps = {
  loadCandidates: () => Promise<ChunkRow[]>;
  writeEmbedding: (chunkId: string, vectorLiteral: string) => Promise<void>;
  countMissing: () => Promise<number>;
  provider: EmbeddingProvider;
  /** Chunks per provider call. OpenAI batches; the offline fixture is free. */
  batchSize?: number;
  onProgress?: (done: number, total: number) => void;
};

export async function backfillEmbeddings(deps: BackfillDeps): Promise<BackfillResult> {
  const { provider, writeEmbedding } = deps;
  const batchSize = deps.batchSize ?? 64;

  const plan = planBackfill(await deps.loadCandidates(), provider);
  const todo = plan.embed;

  let done = 0;
  for (let i = 0; i < todo.length; i += batchSize) {
    const batch = todo.slice(i, i + batchSize);
    const vectors = await provider.embedMany(batch.map((c) => c.content));

    if (vectors.length !== batch.length) {
      throw new EmbeddingError(
        `Provider returned ${vectors.length} vectors for ${batch.length} inputs`,
        "PROVIDER_ERROR",
      );
    }

    for (const [offset, chunk] of batch.entries()) {
      const vector = vectors[offset];
      if (vector.length !== EMBED_DIM) {
        throw new EmbeddingError(
          `Provider ${provider.id} returned ${vector.length} dimensions; the column is vector(${EMBED_DIM})`,
          "DIMENSION_MISMATCH",
        );
      }
      // Cosine distance is only meaningful on unit vectors, and the stored and
      // query paths must agree, so this is checked before every write.
      assertUsableVector(vector);
      await writeEmbedding(chunk.id, toVectorLiteral(vector));
    }

    done += batch.length;
    deps.onProgress?.(done, todo.length);
  }

  return {
    embedded: done,
    skipped: plan.skip,
    remaining: await deps.countMissing(),
  };
}

/**
 * Summarise a run for the log and for the Phase 6A protocol record.
 */
export function describeBackfill(result: BackfillResult, providerId: string): string {
  const byReason = new Map<SkipReason, number>();
  for (const s of result.skipped) {
    byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1);
  }
  const skipPart =
    result.skipped.length === 0
      ? "no skips"
      : [...byReason.entries()].map(([r, n]) => `${n} ${r}`).join(", ");
  return `embedded ${result.embedded} chunk(s) with ${providerId}; skipped ${result.skipped.length} (${skipPart}); ${result.remaining} still awaiting an embedding`;
}
