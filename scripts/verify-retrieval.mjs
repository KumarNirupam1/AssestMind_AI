// Run one query down the vector path and one down the keyword path, in raw SQL,
// to prove retrieval works before the agent is involved. If keyword search is
// broken you want to know now, not during Phase 6B.
//
// Read-only. Touches no rows.
//
// Usage:
//   npm run verify:retrieval
//   npm run verify:retrieval -- --query "coolant concentration"

import "dotenv/config";
import pg from "pg";

import {
  buildKeywordSearchQuery,
  buildVectorSearchQuery,
  embedQuery,
} from "../features/ingestion/retrieval.ts";
import { resolveEmbeddingProvider, EMBED_MODEL } from "../features/ingestion/embedding.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const argQuery = process.argv.indexOf("--query");
const text = argQuery !== -1 ? process.argv[argQuery + 1] : "coolant concentration and flow";

const client = new pg.Client({ connectionString: url });
const provider = resolveEmbeddingProvider();
const failures = [];

function check(name, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures.push(name);
}

try {
  await client.connect();

  const { rows: counts } = await client.query(
    `SELECT count(*)::int AS "total",
            count("embedding")::int AS "embedded",
            count(*) FILTER (WHERE "embedding" IS NULL)::int AS "missing"
       FROM "DocumentChunk"`,
  );
  const { total, embedded, missing } = counts[0];
  console.log(`chunks: ${total}, embedded: ${embedded}, missing: ${missing}\n`);

  check("at least one chunk is embedded", embedded > 0, `${embedded}/${total}`);
  if (missing > 0) {
    console.log(`  note: ${missing} chunk(s) still null — run npm run embed:backfill`);
  }

  // ---- keyword path
  const kw = buildKeywordSearchQuery({ query: text, topK: 5 });
  const kwRes = await client.query(kw.sql, kw.params);
  check("keyword path returns results", kwRes.rows.length > 0, `${kwRes.rows.length} row(s)`);
  if (kwRes.rows.length > 0) {
    const r = kwRes.rows[0];
    console.log(`  top keyword hit: ${r.docType} "${r.title}" #${r.ordinal} rank=${Number(r.rank).toFixed(4)}`);
    check("keyword rows carry citation provenance", Boolean(r.id && r.sourceKey && r.ordinal !== null));
  }

  // ---- vector path
  const vector = await embedQuery(text, provider);
  const vec = buildVectorSearchQuery({ queryVector: vector, topK: 5, embedModel: EMBED_MODEL });
  const vecRes = await client.query(vec.sql, vec.params);
  check("vector path returns results", vecRes.rows.length > 0, `${vecRes.rows.length} row(s)`);
  if (vecRes.rows.length > 0) {
    const r = vecRes.rows[0];
    console.log(`  top vector hit:  ${r.docType} "${r.title}" #${r.ordinal} distance=${Number(r.distance).toFixed(6)}`);
    check("vector rows carry citation provenance", Boolean(r.id && r.sourceKey && r.ordinal !== null));

    // Cosine distance to itself is ~0. This is the property that makes the
    // ordering meaningful, and it only holds if stored and query vectors were
    // normalised and rounded identically.
    check("nearest neighbour distance is near zero", Number(r.distance) < 1e-3, `${Number(r.distance).toExponential(2)}`);

    // Ordering must be ascending, or LIMIT returns the worst matches.
    const distances = vecRes.rows.map((x) => Number(x.distance));
    const ascending = distances.every((d, i) => i === 0 || d >= distances[i - 1]);
    check("vector results are ordered by ascending distance", ascending, distances.map((d) => d.toFixed(4)).join(" "));
  }

  // The two paths are independent and are expected to disagree. That is the
  // point of having both, so this is reported rather than asserted.
  const overlap = new Set(kwRes.rows.map((r) => r.id));
  const shared = vecRes.rows.filter((r) => overlap.has(r.id)).length;
  console.log(`\n  paths agree on ${shared}/${Math.max(kwRes.rows.length, vecRes.rows.length)} of the top 5`);
  console.log(`  (disagreement is expected; it is what the retrieval ablation measures)`);

  console.log();
  if (failures.length) {
    console.error(`${failures.length} check(s) failed: ${failures.join("; ")}`);
    process.exitCode = 1;
  } else {
    console.log("All retrieval checks passed.");
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
