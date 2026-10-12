/**
 * features/ingestion/inngest-functions.ts
 *
 * Background functions triggered via Inngest events.
 *
 * Event: `assetmind/document.ingest`
 *   payload: { documentId: string; s3Key: string; assetId?: string }
 *
 * The function:
 *   1. Fetches the raw document from S3 (using the key stored in Document.sourceKey)
 *   2. Splits it into chunks (sentence-aware, max 512 tokens)
 *   3. Writes DocumentChunk rows with embedding = null
 *   4. Embeds all chunks via the active EmbeddingProvider (must be "openai" in prod)
 *   5. Marks the Document.ingestedAt timestamp
 *
 * If the embedding provider is "deterministic" the step still runs — the
 * chunks land in the DB — but a warning is logged and the embeddings will be
 * placeholder hashes, not real vectors. Run embed:backfill after switching to
 * the openai provider to replace them.
 */
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod";

import { inngest } from "@/lib/inngest";
import { prisma } from "@/lib/db";
import { getS3, S3_DOCUMENT_BUCKET } from "@/lib/s3";
import {
  resolveEmbeddingProvider,
  toVectorLiteral,
  assertUsableVector,
  EMBED_MODEL,
  EMBED_DIM,
} from "@/features/ingestion/embedding";

// ---------------------------------------------------------------------------
// Typed event payload
// ---------------------------------------------------------------------------
export type DocumentIngestPayload = {
  documentId: string;
  /** The S3 object key stored in Document.sourceKey (e.g. "raw/asset-1/manual.pdf.txt"). */
  s3Key: string;
  assetId?: string;
};

const IngestPayloadSchema = z.object({
  documentId: z.string().min(1),
  s3Key: z.string().min(1),
  assetId: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Chunker — simple sentence-boundary splitter.
// 512-token target; 1 token ≈ 4 chars (rough English approximation).
// ---------------------------------------------------------------------------
const CHUNK_TARGET_CHARS = 512 * 4;
const CHUNKER_VERSION = "sentence-v1";

function chunkText(text: string): string[] {
  // Split on sentence endings followed by whitespace or end-of-string.
  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (current.length + sentence.length > CHUNK_TARGET_CHARS && current.length > 0) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current += (current.length > 0 ? " " : "") + sentence;
    }
  }
  if (current.trim().length > 0) chunks.push(current.trim());
  return chunks;
}

// ---------------------------------------------------------------------------
// The function
// ---------------------------------------------------------------------------
export const ingestDocument = inngest.createFunction(
  {
    id: "ingest-document",
    name: "Ingest document from S3",
    retries: 3,
    triggers: [{ event: "assetmind/document.ingest" }],
  },
  async ({ event, step }: { event: { data: unknown }; step: { run: <T>(id: string, fn: () => Promise<T>) => Promise<T> } }) => {
    // Validate event payload — a bad payload should not retry.
    const payload = IngestPayloadSchema.safeParse(event.data);
    if (!payload.success) {
      throw new Error(`Invalid event payload: ${payload.error.message}`);
    }
    const { documentId, s3Key } = payload.data;

    // ------------------------------------------------------------------
    // Step 1: Fetch text from S3
    // ------------------------------------------------------------------
    const rawText = await step.run("fetch-from-s3", async () => {
      const s3 = getS3();
      const cmd = new GetObjectCommand({ Bucket: S3_DOCUMENT_BUCKET, Key: s3Key });
      const response = await s3.send(cmd);
      if (!response.Body) throw new Error(`S3 object ${s3Key} has no body`);
      return response.Body.transformToString("utf-8");
    });

    // ------------------------------------------------------------------
    // Step 2: Chunk the text and write DocumentChunk rows
    // ------------------------------------------------------------------
    const chunkIds = await step.run("write-chunks", async () => {
      const chunks = chunkText(rawText);
      if (chunks.length === 0) throw new Error(`Document ${documentId} produced 0 chunks`);

      // Delete any stale chunks from a previous ingestion attempt.
      await prisma.documentChunk.deleteMany({ where: { documentId } });

      const created = await Promise.all(
        chunks.map((content, ordinal) =>
          prisma.documentChunk.create({
            data: {
              documentId,
              ordinal,
              content,
              tokenCount: Math.ceil(content.length / 4),
              embedModel: EMBED_MODEL,
              embedDim: EMBED_DIM,
              chunkerVersion: CHUNKER_VERSION,
              // embedding written in the next step
            },
            select: { id: true, content: true },
          }),
        ),
      );

      return created.map((r) => ({ id: r.id, content: r.content }));
    });

    // ------------------------------------------------------------------
    // Step 3: Embed all chunks
    // ------------------------------------------------------------------
    await step.run("embed-chunks", async () => {
      const provider = resolveEmbeddingProvider();

      if (provider.id !== EMBED_MODEL) {
        console.warn(
          `[ingest-document] Embedding provider is "${provider.id}" not "${EMBED_MODEL}". ` +
            `Chunks will be stored with placeholder embeddings. Run npm run embed:backfill after switching to openai.`,
        );
      }

      const texts = chunkIds.map((c) => c.content);
      const vectors = await provider.embedMany(texts);

      await Promise.all(
        chunkIds.map(async (chunk, i) => {
          const vector = vectors[i];
          assertUsableVector(vector);
          await prisma.$executeRaw`
            UPDATE "DocumentChunk"
            SET "embedding" = ${toVectorLiteral(vector)}::vector
            WHERE "id" = ${chunk.id}
          `;
        }),
      );
    });

    // ------------------------------------------------------------------
    // Step 4: Mark document as ingested
    // ------------------------------------------------------------------
    await step.run("mark-ingested", async () => {
      await prisma.document.update({
        where: { id: documentId },
        data: { ingestedAt: new Date() },
      });
    });

    return { documentId, chunks: chunkIds.length };
  },
);
