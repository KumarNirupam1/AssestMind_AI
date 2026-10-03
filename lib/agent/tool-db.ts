import type { PrismaClient } from "@/lib/generated/prisma/client";
import type {
  AssetStatus,
  DocumentType,
  FaultMode,
  MaintenanceType,
  QualityVariant,
  Severity,
} from "@/lib/generated/prisma/enums";

/**
 * ToolDb — the narrow read surface the six agent tools are built on.
 *
 * The tool modules depend on this interface, never on Prisma directly, so the
 * tools are unit-testable with an in-memory fake (the integration tests then
 * run the same modules against the seeded database on a machine that can
 * reach it). It is deliberately read-only: an investigation agent must not be
 * able to mutate the fleet.
 */

export type ChunkHit = {
  id: string;
  ordinal: number;
  documentTitle: string;
  docType: DocumentType;
  sourceKey: string;
  isSynthetic: boolean;
  /** Cosine distance for vector search, ts_rank for keyword search. */
  score: number;
};

export type FaultRow = {
  id: string;
  mode: FaultMode;
  severity: Severity;
  occurredAt: Date;
  resolved: boolean;
  description: string;
};

export type MaintenanceRow = {
  id: string;
  type: MaintenanceType;
  performedAt: Date;
  description: string;
  technician: string | null;
};

export type ComponentRow = {
  name: string;
  type: string;
  criticality: Severity;
};

export type FaultCounts = { total: number; open: number };

export type AssetContextRow = {
  id: string;
  name: string;
  model: string;
  serialNumber: string;
  manufacturer: string | null;
  site: string | null;
  installedAt: Date | null;
  status: AssetStatus;
  components: ComponentRow[];
  faults: FaultCounts;
  documentCount: number;
};

export type ReadingRow = {
  id: string;
  recordedAt: Date;
  airTempK: number;
  processTempK: number;
  rotationalSpeedRpm: number;
  torqueNm: number;
  toolWearMin: number;
  qualityVariant: QualityVariant;
};

export interface ToolDb {
  /** Asset id for a name like `PUMP-101`, or null when no such asset exists. */
  resolveAssetId(name: string): Promise<string | null>;

  /** Run a parameterised query (used by the exact-scan retrieval builders). */
  rawQuery<T>(sql: string, params: unknown[]): Promise<T[]>;

  getAssetContext(assetId: string): Promise<AssetContextRow | null>;
  listFaults(assetId: string, limit: number): Promise<FaultRow[]>;
  countFaults(assetId: string): Promise<FaultCounts>;
  listMaintenance(assetId: string, limit: number): Promise<MaintenanceRow[]>;
  getReadingByUdi(assetId: string, udi: number): Promise<ReadingRow | null>;
  getReadingAtOrBefore(assetId: string, at: Date): Promise<ReadingRow | null>;
}

export function createPrismaToolDb(prisma: PrismaClient): ToolDb {
  return {
    async resolveAssetId(name) {
      const asset = await prisma.asset.findUnique({
        where: { name },
        select: { id: true },
      });
      return asset?.id ?? null;
    },

    rawQuery<T>(sql: string, params: unknown[]): Promise<T[]> {
      // `$queryRawUnsafe` because the parameter list is dynamic and the SQL is
      // built by the tested retrieval builders. Parameter values are bound
      // placeholders, never interpolated user text.
      return prisma.$queryRawUnsafe<T[]>(sql, ...params);
    },

    async getAssetContext(assetId) {
      const [asset, components, faults, documentCount] = await Promise.all([
        prisma.asset.findUnique({
          where: { id: assetId },
          select: {
            id: true,
            name: true,
            model: true,
            serialNumber: true,
            manufacturer: true,
            site: true,
            installedAt: true,
            status: true,
          },
        }),
        prisma.component.findMany({
          where: { assetId },
          orderBy: { createdAt: "asc" },
          select: { name: true, type: true, criticality: true },
        }),
        Promise.all([
          prisma.faultRecord.count({ where: { assetId } }),
          prisma.faultRecord.count({ where: { assetId, resolvedAt: null } }),
        ]),
        prisma.document.count({ where: { assetId } }),
      ]);

      if (!asset) return null;

      return {
        ...asset,
        components,
        faults: {
          total: faults[0],
          open: faults[1],
        },
        documentCount,
      };
    },

    async listFaults(assetId, limit) {
      const rows = await prisma.faultRecord.findMany({
        where: { assetId },
        orderBy: { occurredAt: "desc" },
        take: limit,
        select: {
          id: true,
          mode: true,
          severity: true,
          occurredAt: true,
          resolvedAt: true,
          description: true,
        },
      });
      return rows.map((row) => ({
        ...row,
        resolved: row.resolvedAt !== null,
      }));
    },

    async countFaults(assetId) {
      const [total, open] = await Promise.all([
        prisma.faultRecord.count({ where: { assetId } }),
        prisma.faultRecord.count({ where: { assetId, resolvedAt: null } }),
      ]);
      return { total, open };
    },

    async listMaintenance(assetId, limit) {
      return prisma.maintenanceLog.findMany({
        where: { assetId },
        orderBy: { performedAt: "desc" },
        take: limit,
        select: {
          id: true,
          type: true,
          performedAt: true,
          description: true,
          technician: true,
        },
      });
    },

    async getReadingByUdi(assetId, udi) {
      return prisma.sensorReading.findFirst({
        where: { assetId, id: String(udi) },
        select: {
          id: true,
          recordedAt: true,
          airTempK: true,
          processTempK: true,
          rotationalSpeedRpm: true,
          torqueNm: true,
          toolWearMin: true,
          qualityVariant: true,
        },
      });
    },

    async getReadingAtOrBefore(assetId, at) {
      return prisma.sensorReading.findFirst({
        where: { assetId, recordedAt: { lte: at } },
        orderBy: { recordedAt: "desc" },
        select: {
          id: true,
          recordedAt: true,
          airTempK: true,
          processTempK: true,
          rotationalSpeedRpm: true,
          torqueNm: true,
          toolWearMin: true,
          qualityVariant: true,
        },
      });
    },
  };
}