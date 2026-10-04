// One-off script: enables pgvector extension on the RDS instance.
// Run once after RDS is available: node scripts/setup-pgvector.mjs
import pg from "pg";

const { Pool } = pg;

const connStr = process.env.DATABASE_URL.replace(
  "sslmode=require",
  "sslmode=require"
);
const pool = new Pool({
  connectionString: connStr,
  ssl: { rejectUnauthorized: false },
});

try {
  const res = await pool.query(
    "CREATE EXTENSION IF NOT EXISTS vector; SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';"
  );
  console.log("pgvector:", res[1].rows[0]);
} finally {
  await pool.end();
}
