import { describe, expect, it } from "vitest";

import {
  EMBED_DIM,
  EmbeddingError,
  assertUsableVector,
  createDeterministicEmbeddingProvider,
  normalizeVector,
  parseVectorLiteral,
  resolveEmbeddingProvider,
  roundVector,
  toVectorLiteral,
  vectorLength,
} from "@/features/ingestion/embedding";

describe("vector helpers", () => {
  it("normalises to unit length", () => {
    const v = normalizeVector([3, 4]);
    expect(vectorLength(v)).toBeCloseTo(1, 6);
  });

  it("refuses to normalise a zero vector", () => {
    // Cosine distance against a zero vector is undefined; storing one would
    // produce a row that silently matches nothing.
    expect(() => normalizeVector([0, 0, 0])).toThrow(EmbeddingError);
  });

  it("rounds to a fixed grid so stored and query vectors agree", () => {
    const a = roundVector([1 / 3]);
    const b = roundVector([0.3333333333333333]);
    expect(a).toEqual(b);
    expect(roundVector(a)).toEqual(a);
  });

  it("round-trips through the pgvector literal form", () => {
    const v = normalizeVector([0.1, -0.2, 0.3]);
    expect(parseVectorLiteral(toVectorLiteral(v))).toEqual(v);
  });

  it("asserts the column dimension", () => {
    expect(() => assertUsableVector([1, 0, 0])).toThrow(/1536/);
    expect(() => assertUsableVector(new Array(EMBED_DIM).fill(0))).toThrow(/unit length/);
    expect(() => assertUsableVector(normalizeVector(new Array(EMBED_DIM).fill(1)))).not.toThrow();
  });
});

describe("deterministic provider", () => {
  const provider = createDeterministicEmbeddingProvider();

  it("emits the column dimension", async () => {
    const [v] = await provider.embedMany(["coolant flow below 4 L/min"]);
    expect(v).toHaveLength(EMBED_DIM);
  });

  it("emits unit vectors, as cosine distance requires", async () => {
    const vectors = await provider.embedMany([
      "coolant flow",
      "a much longer document body about spindle torque and tool wear ".repeat(20),
    ]);
    for (const v of vectors) {
      expect(vectorLength(v)).toBeCloseTo(1, 3);
      expect(() => assertUsableVector(v)).not.toThrow();
    }
  });

  it("is reproducible across calls and instances", async () => {
    const text = "PUMP-201 spindle inspection procedure";
    const a = await provider.embedMany([text]);
    const b = await createDeterministicEmbeddingProvider().embedMany([text]);
    expect(a[0]).toEqual(b[0]);
  });

  it("is order-independent per input", async () => {
    const texts = ["alpha beta", "gamma delta", "epsilon"];
    const forward = await provider.embedMany(texts);
    const reversed = await provider.embedMany([...texts].reverse());
    expect(reversed[0]).toEqual(forward[2]);
  });

  it("ranks lexically similar text above unrelated text", () => {
    // It is a bag-of-words projection, so this is the only similarity it has.
    // Proves the plumbing can order results; says nothing about semantics.
    const cos = (a: number[], b: number[]) =>
      a.reduce((s, n, i) => s + n * b[i], 0);
    return provider.embedMany([
      "coolant flow below 4 L/min indicates failure",
      "coolant concentration is 9 percent emulsion",
      "the quarterly finance report lists revenue by region",
    ]).then(([related, similar, unrelated]) => {
      expect(cos(related, similar)).toBeGreaterThan(cos(related, unrelated));
    });
  });

  it("handles empty content without producing a zero vector", async () => {
    const [v] = await provider.embedMany(["   "]);
    expect(v).toHaveLength(EMBED_DIM);
    expect(vectorLength(v)).toBeCloseTo(1, 3);
  });
});

describe("provider resolution", () => {
  it("defaults to the offline fixture so nothing needs a key", () => {
    expect(resolveEmbeddingProvider().id).toBe("deterministic-hash-v1");
  });

  it("selects openai only on an explicit request", () => {
    // One explicit switch, so an evaluation run cannot silently use the
    // fixture and report meaningless recall.
    const provider = resolveEmbeddingProvider("openai");
    expect(provider.id).toBe("text-embedding-3-small");
    expect(provider.dimensions).toBe(EMBED_DIM);
  });

  it("rejects an unknown provider", () => {
    expect(() => resolveEmbeddingProvider("cohere")).toThrow(/Unknown/);
  });

  it("fails with PROVIDER_UNAVAILABLE rather than crashing when no key is set", async () => {
    const provider = resolveEmbeddingProvider("openai");
    const key = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      // The key was captured at construction, so rebuild without one.
      const { createOpenAIEmbeddingProvider } = await import("@/features/ingestion/embedding");
      await expect(createOpenAIEmbeddingProvider(undefined).embedMany(["x"])).rejects.toThrow(
        /OPENAI_API_KEY/,
      );
      await expect(createOpenAIEmbeddingProvider("").embedMany(["x"])).rejects.toThrow(
        /OPENAI_API_KEY/,
      );
    } finally {
      if (key !== undefined) process.env.OPENAI_API_KEY = key;
    }
  });
});
