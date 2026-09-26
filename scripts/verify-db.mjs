import "dotenv/config";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
const failures = [];

function check(name, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures.push(name);
}

const TABLES = [
  "Asset",
  "Component",
  "SensorReading",
  "FaultRecord",
  "MaintenanceLog",
  "Document",
  "DocumentChunk",
  "Chat",
  "ChatMessage",
];

try {
  await client.connect();
  console.log("connected\n");

  const { rows: ext } = await client.query(
    "select extname, extversion from pg_extension where extname = 'vector'",
  );
  check(
    "pgvector extension installed",
    ext.length === 1,
    ext.length ? `v${ext[0].extversion}` : "not installed",
  );

  const { rows: cols } = await client.query(
    `select column_name, data_type, udt_name, is_generated
       from information_schema.columns
      where table_name = 'DocumentChunk'
      order by ordinal_position`,
  );

  const embedding = cols.find((c) => c.column_name === "embedding");
  check(
    "embedding is a vector column",
    embedding?.udt_name === "vector",
    embedding ? `${embedding.udt_name ?? embedding.data_type}` : "missing",
  );

  const searchVector = cols.find((c) => c.column_name === "searchVector");
  check(
    "searchVector is a generated column",
    searchVector?.is_generated === "ALWAYS",
    searchVector
      ? `${searchVector.udt_name}, is_generated=${searchVector.is_generated}`
      : "missing",
  );

  const { rows: idx } = await client.query(
    `select indexname, indexdef from pg_indexes
      where tablename = 'DocumentChunk' order by indexname`,
  );
  const gin = idx.find(
    (r) => r.indexdef.includes("USING gin") && r.indexdef.includes("searchVector"),
  );
  check(
    "GIN index on searchVector present",
    Boolean(gin),
    gin ? gin.indexname : `no GIN index; found: ${idx.map((r) => r.indexname).join(", ")}`,
  );

  const { rows: present } = await client.query(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_name = any($1)`,
    [TABLES],
  );
  const found = present.map((r) => r.table_name);
  const missing = TABLES.filter((t) => !found.includes(t));
  check(
    "all 9 tables exist",
    missing.length === 0,
    missing.length ? `missing: ${missing.join(", ")}` : `${found.length}/${TABLES.length}`,
  );

  if (missing.length === 0) {
    const counts = {};
    for (const t of TABLES) {
      const { rows } = await client.query(`select count(*)::int as n from "${t}"`);
      counts[t] = rows[0].n;
    }
    console.log("\nrow counts");
    console.table(counts);
  }

  const { rows: applied } = await client.query(
    `select migration_name, finished_at, rolled_back_at, logs
       from _prisma_migrations order by started_at`,
  );
  console.log("\n_prisma_migrations");
  console.table(
    applied.map((m) => ({
      migration: m.migration_name,
      finished: m.finished_at ? "yes" : "NO",
      rolled_back: m.rolled_back_at ? "yes" : "no",
      error: m.logs ? m.logs.slice(0, 80) : "",
    })),
  );
} catch (err) {
  console.error(`\nconnection failed: ${err.message}`);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}

console.log(
  failures.length === 0
    ? "\nall checks passed"
    : `\n${failures.length} check(s) failed: ${failures.join(", ")}`,
);
process.exit(failures.length === 0 ? 0 : 1);
