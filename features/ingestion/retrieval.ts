import { EMBED_DIM, parseVectorLiteral, roundVector, toVectorLiteral, normalizeVector } from "./embedding.ts";

/**
 * Retrieval query builders.
 *
 * Both paths are **exact scans**. There is no ANN index on `DocumentChunk.embedding`
 * and none will be added until every Phase 6B configuration is frozen: an
 * approximate index would make recall a function of the index's own build
 * parameters, which is a confound the evaluation cannot control. The GIN index
 * on the generated `searchVector` is exact by construction, so the keyword
 * path stays indexed while the vector path is a sequential scan.
 *
 * Both builders are pure string builders with no database access, so the SQL
 * that the evaluation depends on is asserted in tests rather than discovered
 * in a result table.
 *
 * ## The distance operator
 *
 * pgvector's cosine distance is `<=>`. Cosine distance requires unit vectors
 * on the indexed path, and is only comparable between two vectors that went
 * through the same normalisation and rounding. So the query vector is
 * normalised and rounded with the *same* functions the write path uses, and
 * formatted with the same `toVectorLiteral`. Changing one without the other
 * would silently shift every distance.
 */

/** Maximum chunks a single tool call may return. Per-tool caps are a Phase 4 concern. */
export const MAX_TOP_K = 25;

export type VectorSearchQuery = {
  sql: string;
  params: unknown[];
};

/**
 * Exact k-nearest-neighbour search by cosine distance.
 *
 * `ORDER BY embedding <=> $1::vector` with no index is a sequential scan over
 * every chunk and therefore exact. `assetId` narrows the scan to one asset,
 * which is both faster and the semantically correct scope for an investigation
 * agent asked about a specific machine.
 */
export function buildVectorSearchQuery(input: {
  queryVector: number[];
  topK?: number;
  assetId?: string;
  /** Restrict to a model, so a run cannot mix embedding spaces. */
  embedModel?: string;
}): VectorSearchQuery {
  const topK = clampTopK(input.topK);

  if (input.queryVector.length !== EMBED_DIM) {
    throw new Error(
      `Query vector has ${input.queryVector.length} dimensions; expected ${EMBED_DIM}`,
    );
  }

  // Same normalisation and rounding as the stored vectors, so the distances
  // being compared live on the same grid.
  const literal = toVectorLiteral(roundVector(input.queryVector));

  const params: unknown[] = [literal];
  const conditions: string[] = [];

  if (input.assetId) {
    params.push(input.assetId);
    conditions.push(`d."assetId" = $${params.length}`);
  }
  if (input.embedModel) {
    params.push(input.embedModel);
    conditions.push(`c."embedModel" = $${params.length}`);
  }
  // Chunks with no embedding are not candidates. `embedding <=> NULL` would be
  // NULL and sort unpredictably rather than being excluded.
  conditions.push(`c."embedding" IS NOT NULL`);

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  return {
    sql: `
      SELECT
        c."id",
        c."documentId",
        c."ordinal",
        c."content",
        c."embedModel",
        d."title",
        d."docType",
        d."sourceKey",
        d."isSynthetic",
        c."embedding" <=> $1::vector AS "distance"
      FROM "DocumentChunk" c
      JOIN "Document" d ON d."id" = c."documentId"
      ${where}
      ORDER BY c."embedding" <=> $1::vector ASC
      LIMIT ${topK}
    `.trim(),
    params,
  };
}

/**
 * Keyword search over the generated `searchVector`, using the existing GIN
 * index.
 *
 * `websearch_to_tsquery` with the `english` configuration matches the
 * `to_tsvector('english', ...)` expression the column was generated with. If
 * those two ever disagree the index is silently unused and this becomes a
 * sequential scan, so the configuration is a named constant rather than
 * repeated inline.
 */
export const TS_CONFIG = "english";

export type KeywordSearchQuery = {
  sql: string;
  params: unknown[];
};

export function buildKeywordSearchQuery(input: {
  query: string;
  topK?: number;
  assetId?: string;
  embedModel?: string;
}): KeywordSearchQuery {
  const topK = clampTopK(input.topK);
  const trimmed = input.query.trim();
  if (trimmed.length === 0) {
    throw new Error("Keyword query must not be empty");
  }

  const params: unknown[] = [trimmed];
  const conditions: string[] = [`c."searchVector" @@ websearch_to_tsquery('${TS_CONFIG}', $1)`];

  if (input.assetId) {
    params.push(input.assetId);
    conditions.push(`d."assetId" = $${params.length}`);
  }
  if (input.embedModel) {
    params.push(input.embedModel);
    conditions.push(`c."embedModel" = $${params.length}`);
  }

  return {
    sql: `
      SELECT
        c."id",
        c."documentId",
        c."ordinal",
        c."content",
        c."embedModel",
        d."title",
        d."docType",
        d."sourceKey",
        d."isSynthetic",
        ts_rank(c."searchVector", websearch_to_tsquery('${TS_CONFIG}', $1)) AS "rank"
      FROM "DocumentChunk" c
      JOIN "Document" d ON d."id" = c."documentId"
      WHERE ${conditions.join(" AND ")}
      ORDER BY "rank" DESC, c."ordinal" ASC
      LIMIT ${topK}
    `.trim(),
    params,
  };
}

/**
 * Validate and bound `topK`.
 *
 * Interpolated into `LIMIT` because Postgres will not accept a placeholder
 * there, so it is validated as a genuine positive finite number and floored
 * before it ever reaches the SQL string.
 */
export function clampTopK(topK: number | undefined): number {
  if (topK === undefined) return 8;
  if (!Number.isFinite(topK) || topK < 1) {
    throw new Error(`topK must be a positive integer, received ${topK}`);
  }
  // Interpolated, not parameterised, because Postgres will not accept a
  // placeholder in LIMIT. Bounded and validated above.
  return Math.min(Math.floor(topK), MAX_TOP_K);
}

/**
 * Build the query vector for a piece of text using a provider, normalised and
 * rounded exactly as stored vectors are.
 */
export async function embedQuery(
  text: string,
  provider: { embedMany(t: string[]): Promise<number[][]> },
): Promise<number[]> {
  const [vector] = await provider.embedMany([text]);
  if (!vector) {
    throw new Error("Embedding provider returned no vector for the query");
  }
  return normalizeVector(vector);
}

/** Convenience: literal for a query text, ready to bind as `$1::vector`. */
export async function queryVectorLiteral(
  text: string,
  provider: { embedMany(t: string[]): Promise<number[][]> },
): Promise<string> {
  return toVectorLiteral(await embedQuery(text, provider));
}

/** Re-read a stored literal, applying the shared rounding grid. */
export const readVectorLiteral = parseVectorLiteral;
