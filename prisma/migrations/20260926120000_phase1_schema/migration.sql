-- Extensions must exist before any table that uses them.
CREATE EXTENSION IF NOT EXISTS vector;

-- Drop scratch table from the earlier smoke-test migration.
DROP TABLE IF EXISTS "Test";
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('OPERATIONAL', 'DEGRADED', 'MAINTENANCE', 'DOWN');

-- CreateEnum
CREATE TYPE "QualityVariant" AS ENUM ('L', 'M', 'H');

-- CreateEnum
CREATE TYPE "FaultMode" AS ENUM ('TWF', 'HDF', 'PWF', 'OSF', 'RNF');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "MaintenanceType" AS ENUM ('PREVENTIVE', 'CORRECTIVE', 'INSPECTION', 'CALIBRATION');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('MANUAL', 'SOP', 'FAULT_NARRATIVE', 'INSPECTION_REPORT');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "manufacturer" TEXT,
    "site" TEXT,
    "installedAt" TIMESTAMP(3),
    "status" "AssetStatus" NOT NULL DEFAULT 'OPERATIONAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Component" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "criticality" "Severity" NOT NULL DEFAULT 'MEDIUM',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Component_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SensorReading" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "airTempK" DOUBLE PRECISION NOT NULL,
    "processTempK" DOUBLE PRECISION NOT NULL,
    "rotationalSpeedRpm" DOUBLE PRECISION NOT NULL,
    "torqueNm" DOUBLE PRECISION NOT NULL,
    "toolWearMin" DOUBLE PRECISION NOT NULL,
    "qualityVariant" "QualityVariant" NOT NULL,
    "machineFailure" BOOLEAN NOT NULL DEFAULT false,
    "twf" BOOLEAN NOT NULL DEFAULT false,
    "hdf" BOOLEAN NOT NULL DEFAULT false,
    "pwf" BOOLEAN NOT NULL DEFAULT false,
    "osf" BOOLEAN NOT NULL DEFAULT false,
    "rnf" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SensorReading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FaultRecord" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "sensorReadingId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "mode" "FaultMode" NOT NULL,
    "severity" "Severity" NOT NULL,
    "description" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FaultRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceLog" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "performedAt" TIMESTAMP(3) NOT NULL,
    "type" "MaintenanceType" NOT NULL,
    "description" TEXT NOT NULL,
    "technician" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaintenanceLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "assetId" TEXT,
    "title" TEXT NOT NULL,
    "docType" "DocumentType" NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "isSynthetic" BOOLEAN NOT NULL DEFAULT true,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentChunk" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "tokenCount" INTEGER NOT NULL,
    "embedModel" TEXT NOT NULL,
    "embedDim" INTEGER NOT NULL,
    "chunkerVersion" TEXT NOT NULL,
    "embedding" vector(1536),
    "searchVector" tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce("content", ''))) STORED,

    CONSTRAINT "DocumentChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Chat" (
    "id" TEXT NOT NULL,
    "clerkUserId" TEXT NOT NULL,
    "assetId" TEXT,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Chat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "evidence" JSONB,
    "evidenceVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Asset_name_key" ON "Asset"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_serialNumber_key" ON "Asset"("serialNumber");

-- CreateIndex
CREATE INDEX "Component_assetId_idx" ON "Component"("assetId");

-- CreateIndex
CREATE INDEX "SensorReading_assetId_recordedAt_idx" ON "SensorReading"("assetId", "recordedAt");

-- CreateIndex
CREATE INDEX "SensorReading_machineFailure_idx" ON "SensorReading"("machineFailure");

-- CreateIndex
CREATE INDEX "FaultRecord_assetId_occurredAt_idx" ON "FaultRecord"("assetId", "occurredAt");

-- CreateIndex
CREATE INDEX "FaultRecord_mode_idx" ON "FaultRecord"("mode");

-- CreateIndex
CREATE INDEX "MaintenanceLog_assetId_performedAt_idx" ON "MaintenanceLog"("assetId", "performedAt");

-- CreateIndex
CREATE INDEX "Document_assetId_idx" ON "Document"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentChunk_documentId_ordinal_key" ON "DocumentChunk"("documentId", "ordinal");

-- CreateIndex
CREATE INDEX "Chat_clerkUserId_idx" ON "Chat"("clerkUserId");

-- CreateIndex
CREATE INDEX "Chat_assetId_idx" ON "Chat"("assetId");

-- CreateIndex
CREATE INDEX "ChatMessage_chatId_createdAt_idx" ON "ChatMessage"("chatId", "createdAt");

-- AddForeignKey
ALTER TABLE "Component" ADD CONSTRAINT "Component_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SensorReading" ADD CONSTRAINT "SensorReading_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaultRecord" ADD CONSTRAINT "FaultRecord_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaultRecord" ADD CONSTRAINT "FaultRecord_sensorReadingId_fkey" FOREIGN KEY ("sensorReadingId") REFERENCES "SensorReading"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceLog" ADD CONSTRAINT "MaintenanceLog_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentChunk" ADD CONSTRAINT "DocumentChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chat" ADD CONSTRAINT "Chat_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Full-text search path for searchDocumentsKeyword.
CREATE INDEX "DocumentChunk_searchVector_idx" ON "DocumentChunk" USING GIN ("searchVector");
