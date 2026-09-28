import { describe, expect, it, vi } from "vitest";

import { type ChunkRow, backfillEmbeddings, describeBackfill, planBackfill } from "@/features/ingestion/backfill";
import { EMBED_DIM, createDeterministicEmbeddingProvider, normalizeVector } from "@/features/ingestion/embedding";
import { parseVectorLiteral } from "@/features/ingestion/embedding";

const provider = createDeterministicEmbeddingProvider();

/**
 * A chunk as the *offline fixture* would legitimately record it: the model id
 * matches the provider that is about to write it.
 */
const chunk = (over: Partial<ChunkRow> = {}): ChunkRow => ({
  id: "c1",
  content: "coolant flow below 4 L/min indicates the heat dissipation path is failing",
  embedModel: provider.id,
  embedDim: EMBED_DIM,
  hasEmbedding: false,
  ...over,
});

/** A chunk as the seed actually writes it, recorded against the real model. */
const seededChunk = (over: Partial<ChunkRow> = {}): ChunkRow =>
  chunk({ embedModel: "text-embedding-3-small", ...over });

describe("planBackfill", () => {
  it("embeds chunks with a null embedding", () => {
    const plan = planBackfill([chunk()], provider);
    expect(plan.embed).toHaveLength(1);
    expect(plan.skip).toHaveLength(0);
  });

  it("skips chunks that already have an embedding", () => {
    const plan = planBackfill([chunk({ hasEmbedding: true })], provider);
    expect(plan.embed).toHaveLength(0);
    expect(plan.skip[0].reason).toBe("ALREADY_EMBEDDED");
  });

  it("refuses to re-embed a chunk recorded against another model", () => {
    // Overwriting it would rewrite provenance that earlier runs may cite.
    const plan = planBackfill([seededChunk()], provider);
    expect(plan.embed).toHaveLength(0);
    expect(plan.skip[0].reason).toBe("MODEL_MISMATCH");
  });

  it("will not write fixture vectors into rows recorded as text-embedding-3-small", () => {
    // The safety property that makes the model check worth having. All 66
    // seeded chunks carry the real model id, so running the offline fixture
    // against the live database must embed nothing rather than poison the
    // embedding column with vectors a later run would read as genuine.
    const plan = planBackfill([seededChunk({ id: "a" }), seededChunk({ id: "b" })], provider);
    expect(plan.embed).toHaveLength(0);
    expect(plan.skip.every((s) => s.reason === "MODEL_MISMATCH")).toBe(true);
  });

  it("embeds the seeded rows once the real provider is selected", () => {
    // With ASSETMIND_EMBED_PROVIDER=openai the ids line up and the same 66
    // rows become eligible.
    const plan = planBackfill([seededChunk()], { id: "text-embedding-3-small", dimensions: EMBED_DIM });
    expect(plan.embed).toHaveLength(1);
  });

  it("refuses a chunk whose recorded dimension disagrees with the provider", () => {
    const plan = planBackfill([chunk({ embedDim: 3072 })], provider);
    expect(plan.embed).toHaveLength(0);
    expect(plan.skip[0].reason).toBe("DIMENSION_MISMATCH");
  });

  it("skips empty content", () => {
    const plan = planBackfill([chunk({ content: "   " })], provider);
    expect(plan.skip[0].reason).toBe("EMPTY_CONTENT");
  });

  it("preserves input order so runs are deterministic", () => {
    const rows = [chunk({ id: "b" }), chunk({ id: "a" }), chunk({ id: "c", hasEmbedding: true })];
    const plan = planBackfill(rows, provider);
    expect(plan.embed.map((c) => c.id)).toEqual(["b", "a"]);
  });
});

describe("backfillEmbeddings", () => {
  it("writes one unit-length vector per chunk and nothing else", async () => {
    const writes: { id: string; literal: string }[] = [];
    const result = await backfillEmbeddings({
      provider,
      loadCandidates: async () => [chunk({ id: "a" }), chunk({ id: "b", content: "spindle torque" })],
      writeEmbedding: async (id, literal) => {
        writes.push({ id, literal });
      },
      countMissing: async () => 0,
    });

    expect(result.embedded).toBe(2);
    expect(writes.map((w) => w.id)).toEqual(["a", "b"]);
    for (const w of writes) {
      const v = parseVectorLiteral(w.literal);
      expect(v).toHaveLength(EMBED_DIM);
      expect(Math.sqrt(v.reduce((s, n) => s + n * n, 0))).toBeCloseTo(1, 3);
    }
  });

  it("is a no-op when every chunk already has an embedding", async () => {
    const writeEmbedding = vi.fn();
    const result = await backfillEmbeddings({
      provider,
      loadCandidates: async () => [chunk({ hasEmbedding: true })],
      writeEmbedding,
      countMissing: async () => 0,
    });
    expect(writeEmbedding).not.toHaveBeenCalled();
    expect(result.embedded).toBe(0);
  });

  it("does not create chunks, so a rerun cannot duplicate them", async () => {
    // The backfill only ever writes `embedding` by id. Chunk identity is
    // anchored by @@unique([documentId, ordinal]) and nothing here inserts.
    const inserts: unknown[] = [];
    await backfillEmbeddings({
      provider,
      loadCandidates: async () => [chunk()],
      writeEmbedding: async () => {},
      countMissing: async () => 0,
    });
    expect(inserts).toHaveLength(0);
  });

  it("batches without losing or reordering chunks", async () => {
    const rows = Array.from({ length: 7 }, (_, i) => chunk({ id: `c${i}`, content: `body number ${i}` }));
    const seen: string[] = [];
    const result = await backfillEmbeddings({
      provider,
      loadCandidates: async () => rows,
      writeEmbedding: async (id) => {
        seen.push(id);
      },
      countMissing: async () => 0,
      batchSize: 3,
    });
    expect(result.embedded).toBe(7);
    expect(seen).toEqual(rows.map((r) => r.id));
  });

  it("reports progress across batches", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => chunk({ id: `c${i}`, content: `body ${i}` }));
    const progress: number[] = [];
    await backfillEmbeddings({
      provider,
      loadCandidates: async () => rows,
      writeEmbedding: async () => {},
      countMissing: async () => 0,
      batchSize: 2,
      onProgress: (done) => progress.push(done),
    });
    expect(progress).toEqual([2, 4, 5]);
  });

  it("refuses a provider that returns the wrong number of vectors", async () => {
    const bad = {
      id: provider.id,
      dimensions: EMBED_DIM,
      embedMany: async () => [],
    };
    await expect(
      backfillEmbeddings({
        provider: bad,
        loadCandidates: async () => [chunk()],
        writeEmbedding: async () => {},
        countMissing: async () => 0,
      }),
    ).rejects.toThrow(/returned 0 vectors/);
  });

  it("refuses a vector that is not the column dimension", async () => {
    const bad = {
      id: provider.id,
      dimensions: EMBED_DIM,
      embedMany: async () => [new Array(10).fill(0.1)],
    };
    await expect(
      backfillEmbeddings({
        provider: bad,
        loadCandidates: async () => [chunk()],
        writeEmbedding: async () => {},
        countMissing: async () => 0,
      }),
    ).rejects.toThrow(/10 dimensions/);
  });

  it("refuses a non-unit vector, which would corrupt cosine distance", async () => {
    const bad = {
      id: provider.id,
      dimensions: EMBED_DIM,
      embedMany: async () => [new Array(EMBED_DIM).fill(1)],
    };
    await expect(
      backfillEmbeddings({
        provider: bad,
        loadCandidates: async () => [chunk()],
        writeEmbedding: async () => {},
        countMissing: async () => 0,
      }),
    ).rejects.toThrow(/unit length/);
  });

  it("reports how many chunks still lack an embedding", async () => {
    const result = await backfillEmbeddings({
      provider,
      loadCandidates: async () => [chunk()],
      writeEmbedding: async () => {},
      countMissing: async () => 41,
    });
    expect(result.remaining).toBe(41);
  });
});

describe("describeBackfill", () => {
  it("summarises counts per skip reason", () => {
    const line = describeBackfill(
      {
        embedded: 60,
        skipped: [
          { id: "a", reason: "ALREADY_EMBEDDED", detail: "" },
          { id: "b", reason: "ALREADY_EMBEDDED", detail: "" },
          { id: "c", reason: "MODEL_MISMATCH", detail: "" },
        ],
        remaining: 0,
      },
      "text-embedding-3-small",
    );
    expect(line).toContain("embedded 60");
    expect(line).toContain("2 ALREADY_EMBEDDED");
    expect(line).toContain("1 MODEL_MISMATCH");
    expect(line).toContain("text-embedding-3-small");
  });

  it("says so plainly when nothing was skipped", () => {
    expect(describeBackfill({ embedded: 3, skipped: [], remaining: 0 }, "m")).toContain("no skips");
  });
});
