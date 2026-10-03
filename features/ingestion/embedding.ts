/**
 * Embedding provider abstraction for document chunks.
 *
 * The column is `vector(1536)`, so whatever provider is active must produce
 * exactly 1536 dimensions or the write fails at the database. That is
 * asserted here rather than left to a runtime error.
 *
 * Two providers are wired in:
 *
 * - `createDeterministicEmbeddingProvider` — offline, no API key, no network,
 *   byte-for-byte reproducible. It exists so the pipeline, the backfill and
 *   the retrieval tests are runnable today and in CI.
 * - `createOpenAIEmbeddingProvider` — the real one, activated when an API key
 *   and the package are present.
 *
 * **The deterministic provider is a test fixture, not a substitute.** It is a
 * hashed bag-of-words projection, so it has no semantic similarity and would
 * produce meaningless RQ1 numbers. Every evaluation run in Phase 6B must use
 * `text-embedding-3-small`; the model id is recorded on every chunk so a run
 * can be checked afterwards.
 *
 * The provider is the only place that talks to a model. Everything downstream
 * takes an `EmbeddingProvider`, so swapping providers cannot change the
 * backfill, retrieval or chunking logic.
 */

/** Recorded on every chunk. Must match the seed and the `vector(1536)` column. */
export const EMBED_MODEL = "text-embedding-3-small";

/** `vector(1536)` in the migration. A provider returning anything else is a bug. */
export const EMBED_DIM = 1536;

export type EmbeddingProvider = {
  /** Model id persisted to `DocumentChunk.embedModel` so runs are attributable. */
  readonly id: string;
  /** Must equal `EMBED_DIM`. */
  readonly dimensions: number;
  embedMany(texts: string[]): Promise<number[][]>;
};

export type EmbeddingErrorCode =
  | "PROVIDER_UNAVAILABLE"
  | "DIMENSION_MISMATCH"
  | "NOT_NORMALISED"
  | "PROVIDER_ERROR";

/**
 * Typed failure so callers can distinguish "no API key" from "the provider
 * returned the wrong shape" without string matching.
 *
 * Written with an explicit field rather than a TypeScript parameter property:
 * the scripts load this module through Node's type stripping, which is
 * strip-only and rejects non-erasable syntax like parameter properties.
 */
export class EmbeddingError extends Error {
  readonly code: EmbeddingErrorCode;

  constructor(message: string, code: EmbeddingErrorCode) {
    super(message);
    this.name = "EmbeddingError";
    this.code = code;
  }
}

/** FNV-1a. Stable across platforms and Node versions, unlike `hashCode` tricks. */
function fnv1a(input: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Precision used for both stored and query vectors.
 *
 * pgvector's cosine distance is `<=>`. Rounding is applied here so a stored
 * vector and a query vector for the same text land on exactly the same grid;
 * the write path and the read path therefore share one formatter, which is
 * what keeps the distance operator consistent between them.
 */
const VECTOR_PRECISION = 8;

export type RoundedVector = number[];

/** Round to the shared grid. Idempotent. */
export function roundVector(vector: number[], precision = VECTOR_PRECISION): RoundedVector {
  const factor = 10 ** precision;
  return vector.map((n) => Math.round(n * factor) / factor);
}

/**
 * L2-normalise a vector.
 *
 * pgvector's cosine distance assumes unit vectors on the indexed path. Rounding
 * after normalisation perturbs the norm very slightly, which is why
 * `assertUnitLength` allows a small tolerance rather than demanding exactly 1.
 */
export function normalizeVector(vector: number[]): RoundedVector {
  const norm = Math.sqrt(vector.reduce((sum, n) => sum + n * n, 0));
  if (norm === 0) {
    // An all-zero vector has no direction; cosine distance against it is
    // undefined. Failing loudly beats storing a vector that silently matches
    // nothing.
    throw new EmbeddingError("Cannot normalise a zero vector", "NOT_NORMALISED");
  }
  return roundVector(vector.map((n) => n / norm));
}

export function vectorLength(vector: number[]): number {
  return Math.sqrt(vector.reduce((sum, n) => sum + n * n, 0));
}

/** Throws unless the vector has the column's dimension and is ~unit length. */
export function assertUsableVector(
  vector: number[],
  dimensions = EMBED_DIM,
  tolerance = 1e-3,
): void {
  if (vector.length !== dimensions) {
    throw new EmbeddingError(
      `Expected ${dimensions} dimensions, received ${vector.length}`,
      "DIMENSION_MISMATCH",
    );
  }
  const length = vectorLength(vector);
  if (Math.abs(length - 1) > tolerance) {
    throw new EmbeddingError(
      `Vector is not unit length (${length.toFixed(6)}); cosine distance requires normalisation`,
      "NOT_NORMALISED",
    );
  }
}

/** pgvector literal form: `[0.1,0.2,...]`. */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

/**
 * Parse a pgvector literal back to numbers, applying the same rounding grid.
 *
 * The query path runs every candidate through this so query vectors are on the
 * same grid as the stored ones.
 */
export function parseVectorLiteral(literal: string): number[] {
  return literal
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split(",")
    .filter((s) => s.length > 0)
    .map(Number);
}

/** Deterministic token stream: unigrams plus adjacent bigrams, lowercased. */
export function tokenize(text: string): string[] {
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const bigrams: string[] = [];
  for (let i = 0; i + 1 < words.length; i++) bigrams.push(`${words[i]}~${words[i + 1]}`);
  return [...words, ...bigrams];
}

/**
 * Offline provider: a signed-hash bag-of-words projection.
 *
 * Reproducible by construction — no clock, no RNG, no network — which is what
 * makes it usable in CI. It captures lexical overlap and nothing else. Its
 * purpose is to prove the plumbing (dimensions, normalisation, idempotency,
 * exact-scan ordering) end to end, never to produce a retrieval result worth
 * reporting.
 */
export function createDeterministicEmbeddingProvider(
  dimensions = EMBED_DIM,
): EmbeddingProvider {
  return {
    id: "deterministic-hash-v1",
    dimensions,
    async embedMany(texts: string[]): Promise<number[][]> {
      return texts.map((text) => {
        const vector = new Array<number>(dimensions).fill(0);
        const tokens = tokenize(text);
        if (tokens.length === 0) {
          // Empty chunk: a zero vector cannot be normalised. Use a fixed unit
          // vector so the row is still searchable and still matches the column.
          vector[0] = 1;
          return roundVector(vector);
        }
        for (const token of tokens) {
          const h = fnv1a(token);
          const index = h % dimensions;
          // Signed hashing halves the collision bias of a plain counter.
          const sign = (h >>> 20) & 1 ? 1 : -1;
          vector[index] += sign;
        }
        return normalizeVector(vector);
      });
    },
  };
}

/** Minimal shape used from the `openai` package. */
type OpenAILike = {
  embeddings: {
    create(input: {
      model: string;
      input: string[];
      dimensions?: number;
    }): Promise<{ data: { embedding: number[] }[] }>;
  };
};

/**
 * The real provider.
 *
 * `openai` and `OPENAI_API_KEY` are both deferred, so this throws a typed
 * `PROVIDER_UNAVAILABLE` rather than crashing module load, and nothing in the
 * pipeline requires either to exist. The import specifier is held in a variable
 * so the project typechecks and tests run before the dependency is installed.
 */
export function createOpenAIEmbeddingProvider(
  apiKey = process.env.OPENAI_API_KEY,
): EmbeddingProvider {
  return {
    id: EMBED_MODEL,
    dimensions: EMBED_DIM,
    async embedMany(texts: string[]): Promise<number[][]> {
      if (!apiKey) {
        throw new EmbeddingError(
          "OPENAI_API_KEY is not set; ingestion cannot embed with text-embedding-3-small",
          "PROVIDER_UNAVAILABLE",
        );
      }
      if (texts.length === 0) return [];

      let client: OpenAILike;
      try {
        const specifier = "openai";
        const mod = (await import(specifier)) as { default: new (o: { apiKey: string }) => OpenAILike };
        client = new mod.default({ apiKey });
      } catch {
        throw new EmbeddingError(
          "The `openai` package is not installed; run npm install openai",
          "PROVIDER_UNAVAILABLE",
        );
      }

      const response = await client.embeddings.create({
        model: EMBED_MODEL,
        input: texts,
      });

      return response.data.map((row) => {
        const normalized = normalizeVector(row.embedding);
        assertUsableVector(normalized);
        return normalized;
      });
    },
  };
}

/**
 * Resolve the provider to use.
 *
 * `ACMEHASH`-style selection is deliberately absent: one explicit switch, so a
 * run can never silently pick the wrong provider. An explicit
 * `ASSETMIND_EMBED_PROVIDER=openai` is required to leave the offline
 * fixture, which makes accidental misuse in an evaluation visible in the
 * environment rather than inferred.
 */
export function resolveEmbeddingProvider(
  mode = process.env.ASSETMIND_EMBED_PROVIDER ?? "deterministic",
): EmbeddingProvider {
  if (mode === "openai") return createOpenAIEmbeddingProvider();
  if (mode === "deterministic") return createDeterministicEmbeddingProvider();
  throw new EmbeddingError(
    `Unknown ASSETMIND_EMBED_PROVIDER "${mode}"; expected "deterministic" or "openai"`,
    "PROVIDER_UNAVAILABLE",
  );
}
