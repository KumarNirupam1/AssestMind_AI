import { describe, expect, it } from "vitest";

import {
  MAX_TOP_K,
  TS_CONFIG,
  buildKeywordSearchQuery,
  buildVectorSearchQuery,
  clampTopK,
  embedQuery,
  queryVectorLiteral,
} from "@/features/ingestion/retrieval";
import { EMBED_DIM, createDeterministicEmbeddingProvider, normalizeVector, roundVector, toVectorLiteral } from "@/features/ingestion/embedding";

const unitVector = normalizeVector(new Array(EMBED_DIM).fill(1));

describe("vector search", () => {
  it("uses cosine distance so the query and stored vectors share an operator", () => {
    const { sql } = buildVectorSearchQuery({ queryVector: unitVector });
    expect(sql).toContain('c."embedding" <=> $1::vector');
  });

  it("is an exact scan, with no approximate index", () => {
    // An ANN index would make recall a function of build parameters, which is a
    // confound the evaluation cannot control. The query must stay a plain
    // ORDER BY over a sequential scan.
    const { sql } = buildVectorSearchQuery({ queryVector: unitVector });
    expect(sql).toMatch(/ORDER BY c\."embedding" <=> \$1::vector ASC/);
    expect(sql).not.toMatch(/<#>|<%>|hnsw|ivfflat/i);
  });

  it("excludes chunks with no embedding", () => {
    // `embedding <=> NULL` is NULL, which sorts unpredictably rather than
    // being filtered out.
    const { sql } = buildVectorSearchQuery({ queryVector: unitVector });
    expect(sql).toContain('c."embedding" IS NOT NULL');
  });

  it("carries citation provenance out of the join", () => {
    // Phase 4 turns [chunk:<id>#<n>] back into a source using these columns.
    const { sql } = buildVectorSearchQuery({ queryVector: unitVector });
    for (const column of ['c."ordinal"', 'd."title"', 'd."sourceKey"', 'd."isSynthetic"', 'd."docType"']) {
      expect(sql).toContain(column);
    }
  });

  it("scopes to an asset when asked about one machine", () => {
    const { sql, params } = buildVectorSearchQuery({ queryVector: unitVector, assetId: "pump-201" });
    expect(sql).toContain('d."assetId" = $2');
    expect(params[1]).toBe("pump-201");
  });

  it("can pin the embedding model so a run cannot mix embedding spaces", () => {
    const { sql, params } = buildVectorSearchQuery({
      queryVector: unitVector,
      embedModel: "text-embedding-3-small",
    });
    expect(sql).toContain('c."embedModel" = $2');
    expect(params[1]).toBe("text-embedding-3-small");
  });

  it("rejects a query vector of the wrong dimension", () => {
    expect(() => buildVectorSearchQuery({ queryVector: [1, 2, 3] })).toThrow(/1536/);
  });

  it("applies the same rounding as the write path", () => {
    const raw = new Array(EMBED_DIM).fill(0).map((_, i) => Math.sin(i) * 1e-9);
    const { params } = buildVectorSearchQuery({ queryVector: raw });
    expect(params[0]).toBe(toVectorLiteral(roundVector(raw)));
  });
});

describe("topK clamping", () => {
  it("defaults to 8", () => {
    expect(buildVectorSearchQuery({ queryVector: unitVector }).sql).toContain("LIMIT 8");
  });

  it("caps at the per-tool maximum", () => {
    expect(buildVectorSearchQuery({ queryVector: unitVector, topK: 500 }).sql).toContain(
      `LIMIT ${MAX_TOP_K}`,
    );
  });

  it("floors fractional values", () => {
    expect(clampTopK(3.9)).toBe(3);
  });

  it("rejects zero, negative and non-finite values", () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => clampTopK(bad)).toThrow(/positive integer/);
    }
  });

  it("prevents injection through a numeric topK", () => {
    // topK is interpolated because Postgres will not bind a parameter in
    // LIMIT, so it must be validated as a real number first.
    expect(() => clampTopK("5; DROP TABLE x" as unknown as number)).toThrow();
  });
});

describe("keyword search", () => {
  it("uses the same text search configuration the column was generated with", () => {
    const { sql } = buildKeywordSearchQuery({ query: "coolant flow" });
    expect(sql).toContain(`websearch_to_tsquery('${TS_CONFIG}', $1)`);
    expect(sql).toContain(`ts_rank(c."searchVector"`);
  });

  it("orders by rank then ordinal so ties are stable", () => {
    const { sql } = buildKeywordSearchQuery({ query: "coolant" });
    expect(sql).toMatch(/ORDER BY "rank" DESC, c\."ordinal" ASC/);
  });

  it("rejects an empty query rather than matching nothing silently", () => {
    expect(() => buildKeywordSearchQuery({ query: "   " })).toThrow(/must not be empty/);
  });

  it("carries the same provenance columns as the vector path", () => {
    const { sql } = buildKeywordSearchQuery({ query: "coolant" });
    expect(sql).toContain('d."sourceKey"');
    expect(sql).toContain('c."ordinal"');
  });
});

describe("query embedding", () => {
  const provider = createDeterministicEmbeddingProvider();

  it("normalises a query exactly as stored vectors are normalised", async () => {
    const v = await embedQuery("coolant flow below 4 L/min", provider);
    expect(v).toHaveLength(EMBED_DIM);
    const length = Math.sqrt(v.reduce((s, n) => s + n * n, 0));
    expect(length).toBeCloseTo(1, 3);
  });

  it("is deterministic, so a retrieval test is reproducible", async () => {
    const a = await embedQuery("coolant flow", provider);
    const b = await embedQuery("coolant flow", provider);
    expect(a).toEqual(b);
  });

  it("produces a literal that binds as $1::vector", async () => {
    const literal = await queryVectorLiteral("coolant flow", provider);
    expect(literal.startsWith("[")).toBe(true);
    expect(literal.endsWith("]")).toBe(true);
  });

  it("puts identical text at distance ~0 from itself", async () => {
    // The property that makes cosine distance usable: a query retrieves its
    // own text first.
    const v = await embedQuery("coolant flow below 4 L/min", provider);
    const self = v.reduce((s, n, i) => s + n * v[i], 0);
    expect(self).toBeCloseTo(1, 3);
  });
});
