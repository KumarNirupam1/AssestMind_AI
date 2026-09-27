-- ============================================================================
--  DESTRUCTIVE. Deletes all application data. Schema, migrations, pgvector
--  extension and the searchVector GIN index are NOT affected.
--
--  Run this only when you intend to re-seed from scratch. `prisma/seed.ts`
--  uses asset.create() against a @unique name rather than upsert, so a
--  re-seed over existing rows fails on the constraint instead of updating.
--
--  Usage:
--    npx prisma db execute --file scripts/reset-data.sql
--    npx prisma db seed
--
--  Verify afterwards:
--    node scripts/verify-db.mjs
-- ============================================================================

TRUNCATE TABLE
  "ChatMessage",
  "Chat",
  "MaintenanceLog",
  "FaultRecord",
  "SensorReading",
  "DocumentChunk",
  "Document",
  "Component",
  "Asset"
CASCADE;
