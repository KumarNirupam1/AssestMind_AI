// Backfill `DocumentChunk.embedding` for chunks where it is still null.
//
// The decision of *what* to embed lives in features/ingestion/backfill.ts and
// is unit-tested there. This file only supplies the three I/O edges, because
// Prisma cannot model a `vector` column and the write has to be raw SQL.
//
// Read-then-write, not a single UPDATE ... FROM, so a provider failure part
// way through leaves already-written rows intact and the next run resumes
// rather than restarting.
//
// Usage:
//   ASSETMIND_EMBED_PROVIDER=openai npm run embed:backfill
//   npm run embed:backfill -- --dry-run

import "dotenv/config";
import pg from "pg";

import { backfillEmbeddings, describeBackfill } from "../features/ingestion/backfill.ts";
import { resolveEmbeddingProvider, EMBED_DIM } from "../features/ingestion/embedding.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const dryRun = process.argv.includes("--dry-run");
const client = new pg.Client({ connectionString: url });
const provider = resolveEmbeddingProvider();

try {
  await client.connect();

  const { rows } = await client.query(
    `SELECT "id",
            "content",
            "embedModel",
            "embedDim",
            ("embedding" IS NOT NULL) AS "hasEmbedding"
       FROM "DocumentChunk"
      ORDER BY "documentId", "ordinal"`,
  );

  const before = rows.filter((r) => !r.hasEmbedding).length;
  console.log(`chunks: ${rows.length}, awaiting an embedding: ${before}`);
  console.log(`provider: ${provider.id} (${provider.dimensions} dimensions)`);

  if (provider.id !== "text-embedding-3-small") {
    // Not a warning to be waved through: the seeded rows are recorded against
    // the real model, so the planner will skip every one of them. That is the
    // intended behaviour, and running the fixture here would be a no-op.
    console.log(
      `\nThe active provider is "${provider.id}" but the seeded chunks are recorded as\n` +
        `"text-embedding-3-small". planBackfill refuses to write vectors from a\n` +
        `different model, so this run will embed nothing. Set\n` +
        `ASSETMIND_EMBED_PROVIDER=openai with OPENAI_API_KEY to fill the column.`,
    );
  }

  if (dryRun) {
    const { planBackfill } = await import("../features/ingestion/backfill.ts");
    const plan = planBackfill(rows, provider);
    console.log(`\n--dry-run: would embed ${plan.embed.length}, skip ${plan.skip.length}`);
    const byReason = new Map();
    for (const s of plan.skip) byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1);
    for (const [reason, count] of byReason) console.log(`  ${count} ${reason}`);
    process.exit(0);
  }

  const result = await backfillEmbeddings({
    provider,
    batchSize: 64,
    loadCandidates: async () => rows,
    writeEmbedding: async (chunkId, vectorLiteral) => {
      await client.query(
        `UPDATE "DocumentChunk" SET "embedding" = $1::vector WHERE "id" = $2`,
        [vectorLiteral, chunkId],
      );
    },
    countMissing: async () => {
      const res = await client.query(
        `SELECT count(*)::int AS "n" FROM "DocumentChunk" WHERE "embedding" IS NULL`,
      );
      return res.rows[0].n;
    },
    onProgress: (done, total) => {
      process.stdout.write(`\r  embedded ${done}/${total}`);
    },
  });

  process.stdout.write("\n");
  console.log(describeBackfill(result, provider.id));
  console.log(`column width: vector(${EMBED_DIM})`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
