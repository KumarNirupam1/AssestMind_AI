-- Phase 7 durable quota ledger.
--
-- One row per (clerkUserId, day) — a UTC "YYYY-MM-DD" key written by
-- lib/agent/quota.ts createPrismaUsageStore. Plain table, no vector/tsvector
-- columns, so this migration is hand-safe (no drift-stripping needed).

-- CreateTable
CREATE TABLE "DailyUsage" (
    "clerkUserId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "tokensUsed" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyUsage_pkey" PRIMARY KEY ("clerkUserId","day")
);