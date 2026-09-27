import { deriveHealth, type DerivedHealth } from "@/features/assets/health";
import { prisma } from "@/lib/db";

const ASSET_PAGE_SIZE = 25;
const FAULT_PAGE_SIZE = 25;
const MAINTENANCE_PAGE_SIZE = 25;

/**
 * Sidebar navigation data. Fetched on the server and handed to the client
 * sidebar as props so that no client-side data fetching sits in the read path.
 */
export async function getNavAssets() {
  const assets = await prisma.asset.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      _count: { select: { faultRecords: true } },
      faultRecords: {
        where: { resolvedAt: null },
        select: { id: true },
      },
    },
  });

  return assets.map((a) => ({
    id: a.id,
    name: a.name,
    faultCount: a._count.faultRecords,
    unresolvedCount: a.faultRecords.length,
  }));
}

export async function getFleetSummary() {
  const [assets, readings, faults, unresolved, openModeCounts, lastReading] =
    await Promise.all([
      prisma.asset.count(),
      prisma.sensorReading.count(),
      prisma.faultRecord.count(),
      prisma.faultRecord.count({ where: { resolvedAt: null } }),
      prisma.faultRecord.groupBy({ by: ["mode"], _count: { _all: true } }),
      prisma.sensorReading.findFirst({
        orderBy: { recordedAt: "desc" },
        select: { recordedAt: true },
      }),
    ]);

  const totalReadings = readings;
  const totalFaults = faults;
  const byMode = Object.fromEntries(
    openModeCounts.map((m) => [m.mode, m._count._all]),
  ) as Record<string, number>;

  return {
    assets,
    totalReadings,
    totalFaults,
    unresolved,
    faultRate: totalReadings === 0 ? 0 : totalFaults / totalReadings,
    byMode,
    lastRecordedAt: lastReading?.recordedAt ?? null,
  };
}

export type AssetHealthRow = {
  id: string;
  name: string;
  model: string;
  manufacturer: string | null;
  site: string | null;
  /** Operator-set field, as stored. Not a health signal. */
  status: string;
  /** Computed from unresolved faults over total readings. */
  health: DerivedHealth;
  unresolvedRate: number;
  readings: number;
  failures: number;
  unresolved: number;
  lastReadingAt: Date | null;
  meanTorque: number | null;
  meanToolWear: number | null;
};

export async function getAssetHealth({
  cursor,
  take = ASSET_PAGE_SIZE,
}: {
  cursor?: string;
  take?: number;
} = {}): Promise<{ rows: AssetHealthRow[]; nextCursor: string | null }> {
  const page = await prisma.asset.findMany({
    orderBy: { name: "asc" },
    take: take + 1,
    ...(cursor ? { cursor: { name: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      name: true,
      model: true,
      manufacturer: true,
      site: true,
      status: true,
      _count: { select: { sensorReadings: true, faultRecords: true } },
      faultRecords: { where: { resolvedAt: null }, select: { id: true } },
      sensorReadings: {
        orderBy: { recordedAt: "desc" },
        take: 1,
        select: { recordedAt: true },
      },
    },
  });

  const hasMore = page.length > take;
  const rows = page.slice(0, take);

  const stats = await prisma.sensorReading.groupBy({
    by: ["assetId"],
    where: { assetId: { in: rows.map((a) => a.id) } },
    _avg: { torqueNm: true, toolWearMin: true },
  });
  const statByAsset = new Map(stats.map((s) => [s.assetId, s._avg]));

  return {
    rows: rows.map((a) => {
      const avg = statByAsset.get(a.id);
      return {
        id: a.id,
        name: a.name,
        model: a.model,
        manufacturer: a.manufacturer,
        site: a.site,
        status: a.status,
        health: deriveHealth({
          unresolvedCount: a.faultRecords.length,
          readingCount: a._count.sensorReadings,
        }),
        unresolvedRate: a._count.sensorReadings
          ? a.faultRecords.length / a._count.sensorReadings
          : 0,
        readings: a._count.sensorReadings,
        failures: a._count.faultRecords,
        unresolved: a.faultRecords.length,
        lastReadingAt: a.sensorReadings[0]?.recordedAt ?? null,
        meanTorque: avg?.torqueNm ?? null,
        meanToolWear: avg?.toolWearMin ?? null,
      };
    }),
    nextCursor: hasMore ? (rows[rows.length - 1]?.name ?? null) : null,
  };
}

export async function getAssetDetail(id: string) {
  const asset = await prisma.asset.findUnique({
    where: { id },
    include: {
      components: { orderBy: { name: "asc" } },
      _count: { select: { sensorReadings: true, faultRecords: true, documents: true } },
    },
  });

  if (!asset) return null;

  const [aggregates, modeCounts, lastReading] = await Promise.all([
    prisma.sensorReading.aggregate({
      where: { assetId: id },
      _avg: {
        airTempK: true,
        processTempK: true,
        rotationalSpeedRpm: true,
        torqueNm: true,
        toolWearMin: true,
      },
      _max: { toolWearMin: true, rotationalSpeedRpm: true },
    }),
    prisma.faultRecord.groupBy({
      by: ["mode"],
      where: { assetId: id },
      _count: { _all: true },
    }),
    prisma.sensorReading.findFirst({
      where: { assetId: id },
      orderBy: { recordedAt: "desc" },
      select: { recordedAt: true },
    }),
  ]);

  return {
    ...asset,
    aggregates,
    modeCounts: modeCounts.map((m) => ({ mode: m.mode, count: m._count._all })),
    lastReadingAt: lastReading?.recordedAt ?? null,
  };
}

export type FaultPage = {
  id: string;
  mode: string;
  severity: string;
  description: string;
  occurredAt: Date;
  resolvedAt: Date | null;
  sensorReadingId: string | null;
};

/**
 * Keyset pagination on (occurredAt desc, id desc) so that concurrent inserts
 * cannot cause rows to be skipped or repeated across pages.
 */
export async function getFaults({
  assetId,
  cursor,
  take = FAULT_PAGE_SIZE,
}: {
  assetId: string;
  cursor?: { occurredAt: string; id: string };
  take?: number;
}): Promise<{ rows: FaultPage[]; nextCursor: { occurredAt: string; id: string } | null }> {
  const keyset = cursor
    ? (() => {
        const at = new Date(cursor.occurredAt);
        return {
          OR: [
            { occurredAt: { lt: at } },
            { occurredAt: at, id: { lt: cursor.id } },
          ],
        };
      })()
    : undefined;

  const page = await prisma.faultRecord.findMany({
    where: {
      assetId,
      ...(keyset ?? {}),
    },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: take + 1,
  });

  const hasMore = page.length > take;
  const rows = page.slice(0, take);
  const last = rows[rows.length - 1];

  return {
    rows,
    nextCursor:
      hasMore && last
        ? { occurredAt: last.occurredAt.toISOString(), id: last.id }
        : null,
  };
}

export async function getMaintenance({
  assetId,
  cursor,
  take = MAINTENANCE_PAGE_SIZE,
}: {
  assetId: string;
  cursor?: { performedAt: string; id: string };
  take?: number;
}) {
  const keyset = cursor
    ? (() => {
        const at = new Date(cursor.performedAt);
        return {
          OR: [
            { performedAt: { lt: at } },
            { performedAt: at, id: { lt: cursor.id } },
          ],
        };
      })()
    : undefined;

  const page = await prisma.maintenanceLog.findMany({
    where: {
      assetId,
      ...(keyset ?? {}),
    },
    orderBy: [{ performedAt: "desc" }, { id: "desc" }],
    take: take + 1,
  });

  const hasMore = page.length > take;
  const rows = page.slice(0, take);
  const last = rows[rows.length - 1];

  return {
    rows,
    nextCursor:
      hasMore && last
        ? { performedAt: last.performedAt.toISOString(), id: last.id }
        : null,
  };
}

export async function getRecentReadings(assetId: string, take = 12) {
  return prisma.sensorReading.findMany({
    where: { assetId },
    orderBy: { recordedAt: "desc" },
    take,
  });
}
