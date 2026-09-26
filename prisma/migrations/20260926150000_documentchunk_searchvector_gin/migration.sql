-- Full-text search path for searchDocumentsKeyword.
--
-- This index was in 20260926120000_phase1_schema, but a stray auto-generated
-- migration (created by `prisma migrate dev`, which cannot model tsvector or
-- its GIN index) executed `DROP INDEX "DocumentChunk_searchVector_idx"`
-- against the database before failing on the DROP DEFAULT of a generated
-- column. The migration was then marked rolled back, which cleaned the
-- bookkeeping but not the dropped index. This restores it.
CREATE INDEX "DocumentChunk_searchVector_idx" ON "DocumentChunk" USING GIN ("searchVector");
