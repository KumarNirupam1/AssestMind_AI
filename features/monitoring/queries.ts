import { ProductTypeSchema, type ProcessSample } from "@/features/guardrails/rules";
import {
  baselineSample,
  type MonitoringSeed,
} from "@/features/monitoring/simulation";
import { prisma } from "@/lib/db";

type ReadingRow = {
  airTempK: number;
  processTempK: number;
  rotationalSpeedRpm: number;
  torqueNm: number;
  toolWearMin: number;
  qualityVariant: string;
};

function toSample(reading: ReadingRow): ProcessSample {
  return {
    airTempK: reading.airTempK,
    processTempK: reading.processTempK,
    rotationalSpeedRpm: reading.rotationalSpeedRpm,
    torqueNm: reading.torqueNm,
    toolWearMin: reading.toolWearMin,
    productType: ProductTypeSchema.parse(reading.qualityVariant),
  };
}

/**
 * Server read for the monitoring page: every asset plus its most recent stored
 * readings, which seed the deterministic live simulator. Assets with no
 * readings fall back to a synthetic operational baseline so the page still
 * demos on a partially-seeded database.
 */
export async function getMonitoringSeeds(): Promise<MonitoringSeed[]> {
  const assets = await prisma.asset.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, model: true, site: true, status: true },
  });

  return Promise.all(
    assets.map(async (asset) => {
      const readings = await prisma.sensorReading.findMany({
        where: { assetId: asset.id },
        orderBy: { recordedAt: "desc" },
        take: 24,
        select: {
          airTempK: true,
          processTempK: true,
          rotationalSpeedRpm: true,
          torqueNm: true,
          toolWearMin: true,
          qualityVariant: true,
          recordedAt: true,
        },
      });

      const latest = readings[0] ?? null;
      const productType = latest
        ? ProductTypeSchema.parse(latest.qualityVariant)
        : "M";
      const base = latest ? toSample(latest) : baselineSample(productType);
      const history = [...readings].reverse().map(toSample);

      return {
        assetId: asset.id,
        name: asset.name,
        model: asset.model,
        site: asset.site,
        status: asset.status,
        productType,
        base,
        history: history.length > 0 ? history : [base],
        lastRecordedAt: latest ? latest.recordedAt.toISOString() : null,
      } satisfies MonitoringSeed;
    }),
  );
}
