import { z } from "zod";

/**
 * AI4I 2020 guardrail rules.
 *
 * These thresholds were verified row-by-row against
 * `data/raw/ai4i2020.csv` before being written here. HDF, PWF and OSF
 * reproduce their label columns *exactly* — same rows, not just the same
 * counts. `npm run verify:rules` re-checks that against the dataset and runs
 * in CI, so these constants cannot silently drift away from the labels.
 *
 * The measurements, and the reasoning behind each trap below, are in
 * `docs/adr/0002-ai4i-guardrail-rules.md`.
 *
 * ## TWF and RNF are deliberately absent
 *
 * They are not thresholded in AI4I and no function of the process parameters
 * can predict them:
 *
 * - **TWF** — the tool is replaced *or fails* at a randomly chosen wear time
 *   in 200–240 min. 790 rows sit inside that band but only 46 are labelled
 *   TWF, and 3 TWF rows sit outside it entirely. Predicting it would be
 *   guessing a coin flip.
 * - **RNF** — a 0.1% per-row coin flip. The UCI documentation says 5 rows;
 *   the released CSV has 19.
 *
 * So `GuardrailMode` has three members. Scoring precision/recall on TWF or
 * RNF would measure randomness and invite a false "the guardrails missed the
 * fault" conclusion. They are recorded as evidence and reported as
 * irreducibly random instead.
 */

/**
 * AI4I product quality variant. Not cosmetic: the OSF limit differs by type,
 * and flattening it to a single number yields 125 rows instead of 98.
 */
export const ProductTypeSchema = z.enum(["L", "M", "H"]);
export type ProductType = z.infer<typeof ProductTypeSchema>;

/**
 * One observation from the process. Field names carry units so a rule can
 * never silently mix Kelvin with Celsius or Nm with rpm.
 */
export const ProcessSampleSchema = z.object({
  /** Air temperature, Kelvin. AI4I is Kelvin-native; the UI converts. */
  airTempK: z.number().finite(),
  /** Process temperature, Kelvin. */
  processTempK: z.number().finite(),
  /** Rotational speed, rpm. */
  rotationalSpeedRpm: z.number().finite(),
  /** Torque, Nm. */
  torqueNm: z.number().finite().nonnegative(),
  /** Cumulative tool wear, minutes. */
  toolWearMin: z.number().finite().nonnegative(),
  productType: ProductTypeSchema,
});
export type ProcessSample = z.infer<typeof ProcessSampleSchema>;

/**
 * Thresholds are configuration, not literals buried in rule bodies, so the
 * Phase 6A protocol can record the exact values a run used and a reviewer can
 * tell a documented change from a tuning accident. Validated here at the
 * boundary rather than trusted from a JSON file.
 */
export const GuardrailThresholdSchema = z
  .object({
    hdf: z.object({
      /** Fails when |processTemp - airTemp| is *below* this, in Kelvin. */
      maxTempDeltaK: z.number().positive(),
      /** ...and rotational speed is *below* this. Both clauses are required. */
      maxRotationalSpeedRpm: z.number().positive(),
    }),
    pwf: z.object({
      /** Fails when power falls below this, in watts. */
      minPowerW: z.number().positive(),
      /** Fails when power rises above this, in watts. */
      maxPowerW: z.number().positive(),
    }),
    osf: z.object({
      /** toolWear * torque limit, in min*Nm, keyed by product type. */
      limitByType: z.object({
        L: z.number().positive(),
        M: z.number().positive(),
        H: z.number().positive(),
      }),
    }),
  })
  .refine((t) => t.pwf.minPowerW < t.pwf.maxPowerW, {
    message: "pwf.minPowerW must be below pwf.maxPowerW",
    path: ["pwf"],
  });
export type GuardrailThreshold = z.infer<typeof GuardrailThresholdSchema>;

/** The verified AI4I 2020 thresholds. */
export const AI4I_THRESHOLDS: GuardrailThreshold = {
  hdf: { maxTempDeltaK: 8.6, maxRotationalSpeedRpm: 1380 },
  pwf: { minPowerW: 3500, maxPowerW: 9000 },
  osf: { limitByType: { L: 11000, M: 12000, H: 13000 } },
};

/** Only the modes a rule can actually decide. See the TWF/RNF note above. */
export const GuardrailModeSchema = z.enum(["HDF", "PWF", "OSF"]);
export type GuardrailMode = z.infer<typeof GuardrailModeSchema>;

export const GUARDRAIL_MODES = GuardrailModeSchema.options;

/**
 * A structured verdict, never a bare boolean. RQ3 re-scores guardrail
 * precision/recall from stored evidence, and the paper has to be able to
 * explain *why* a mode fired. Recording the observed values and the applied
 * thresholds makes a verdict auditable without re-running the agent, and
 * keeps a threshold change from rewriting history.
 */
export type GuardrailVerdict = {
  mode: GuardrailMode;
  triggered: boolean;
  /** The measured values this verdict was derived from. */
  observed: Record<string, number>;
  /** The thresholds in force for this run. */
  thresholds: Record<string, number>;
  /**
   * For compound rules, one entry per clause. A triggered compound verdict
   * with an unmet clause would be a bug, and this makes that visible.
   */
  clauses: { name: string; met: boolean; detail: string }[];
  /** Human-readable justification, surfaced in the chat transcript. */
  reason: string;
};

export type GuardrailEvaluation = {
  verdicts: GuardrailVerdict[];
  triggeredModes: GuardrailMode[];
};

/**
 * Mechanical power in watts: torque (Nm) x angular velocity (rad/s).
 *
 * The `2*PI/60` converts rpm to rad/s. This conversion is load-bearing —
 * `torque * speed` ranges 10,967-99,980 across AI4I, so a rule written
 * against the raw product of torque and rpm is wrong by construction.
 */
export function mechanicalPowerW(sample: ProcessSample): number {
  return (sample.torqueNm * 2 * Math.PI * sample.rotationalSpeedRpm) / 60;
}

/**
 * HDF — heat dissipation failure.
 *
 * Both clauses are required: a small temperature delta on its own is normal,
 * and low speed on its own is normal. The spec says "the difference between
 * air- and process temperature is below 8.6 K"; that must be read as an
 * *absolute* difference. Read literally as `airTemp - processTemp < 8.6` it
 * fires on nearly every row, because process temperature is the higher of
 * the two throughout the dataset.
 */
export function evaluateHdf(
  sample: ProcessSample,
  threshold: GuardrailThreshold["hdf"],
): GuardrailVerdict {
  const deltaK = Math.abs(sample.processTempK - sample.airTempK);
  const deltaMet = deltaK < threshold.maxTempDeltaK;
  const speedMet = sample.rotationalSpeedRpm < threshold.maxRotationalSpeedRpm;
  const triggered = deltaMet && speedMet;

  return {
    mode: "HDF",
    triggered,
    observed: {
      tempDeltaK: deltaK,
      rotationalSpeedRpm: sample.rotationalSpeedRpm,
    },
    thresholds: {
      maxTempDeltaK: threshold.maxTempDeltaK,
      maxRotationalSpeedRpm: threshold.maxRotationalSpeedRpm,
    },
    clauses: [
      {
        name: "tempDelta",
        met: deltaMet,
        detail: `|${sample.processTempK} - ${sample.airTempK}| = ${deltaK.toFixed(3)} K vs limit < ${threshold.maxTempDeltaK} K`,
      },
      {
        name: "lowSpeed",
        met: speedMet,
        detail: `${sample.rotationalSpeedRpm} rpm vs limit < ${threshold.maxRotationalSpeedRpm} rpm`,
      },
    ],
    reason: triggered
      ? `Heat dissipation failure: temperature delta ${deltaK.toFixed(2)} K is under ${threshold.maxTempDeltaK} K while running below ${threshold.maxRotationalSpeedRpm} rpm.`
      : `No heat dissipation failure: ${deltaMet ? "temperature delta" : "temperature delta is not low enough"} ${
          speedMet ? "and speed" : "but speed is not low"
        }.`,
  };
}

/**
 * PWF — power failure.
 *
 * Fails when mechanical power leaves the 3500-9000 W band, either
 * direction. Both edges are inclusive-safe: exactly 3500 W or exactly 9000 W
 * does *not* fail.
 */
export function evaluatePwf(
  sample: ProcessSample,
  threshold: GuardrailThreshold["pwf"],
): GuardrailVerdict {
  const powerW = mechanicalPowerW(sample);
  const tooLow = powerW < threshold.minPowerW;
  const tooHigh = powerW > threshold.maxPowerW;
  const triggered = tooLow || tooHigh;

  return {
    mode: "PWF",
    triggered,
    observed: { powerW, torqueNm: sample.torqueNm, rotationalSpeedRpm: sample.rotationalSpeedRpm },
    thresholds: { minPowerW: threshold.minPowerW, maxPowerW: threshold.maxPowerW },
    clauses: [
      {
        name: "powerInBand",
        met: !triggered,
        detail: `${powerW.toFixed(1)} W vs permitted band ${threshold.minPowerW}-${threshold.maxPowerW} W`,
      },
    ],
    reason: triggered
      ? tooLow
        ? `Power failure: ${powerW.toFixed(0)} W is below the ${threshold.minPowerW} W minimum.`
        : `Power failure: ${powerW.toFixed(0)} W exceeds the ${threshold.maxPowerW} W maximum.`
      : `No power failure: ${powerW.toFixed(0)} W is inside the ${threshold.minPowerW}-${threshold.maxPowerW} W band.`,
  };
}

/**
 * OSF — overstrain failure.
 *
 * `toolWear * torque` in min*Nm against a limit that depends on the product
 * quality variant. The per-type split is load-bearing: a flat 11000 limit
 * for every type produces 125 rows where the dataset labels 98.
 */
export function evaluateOsf(
  sample: ProcessSample,
  threshold: GuardrailThreshold["osf"],
): GuardrailVerdict {
  const limit = threshold.limitByType[sample.productType];
  // `productType` is validated by ProcessSampleSchema, so this lookup is
  // total; the fallback exists only to keep the return type honest.
  if (limit === undefined) {
    throw new Error(`No OSF limit for product type ${sample.productType}`);
  }
  const strain = sample.toolWearMin * sample.torqueNm;
  const triggered = strain > limit;

  return {
    mode: "OSF",
    triggered,
    observed: { strain, toolWearMin: sample.toolWearMin, torqueNm: sample.torqueNm },
    thresholds: { limitMinNm: limit },
    clauses: [
      {
        name: "overstrain",
        met: triggered,
        detail: `${strain.toFixed(0)} minNm vs limit ${limit} minNm for product type ${sample.productType}`,
      },
    ],
    reason: triggered
      ? `Overstrain failure: ${strain.toFixed(0)} minNm exceeds the ${limit} minNm limit for a ${sample.productType} product.`
      : `No overstrain failure: ${strain.toFixed(0)} minNm is within the ${limit} minNm limit for a ${sample.productType} product.`,
  };
}

/**
 * Evaluate every deterministic rule against one observation.
 *
 * All three run even after one triggers: a reading can trip more than one
 * mode, and the evidence record should show every clause that was checked
 * rather than stopping at the first hit.
 */
export function evaluateGuardrails(
  sample: ProcessSample,
  threshold: GuardrailThreshold = AI4I_THRESHOLDS,
): GuardrailEvaluation {
  // Both the observation and the thresholds are validated at the boundary. A
  // threshold set that never passed through the schema (an inverted power band,
  // a missing product-type limit) is a silent-wrong-answer bug, and this is
  // the only place a threshold config can enter.
  const parsedThreshold = GuardrailThresholdSchema.parse(threshold);
  const parsedSample = ProcessSampleSchema.parse(sample);
  const verdicts: GuardrailVerdict[] = [
    evaluateHdf(parsedSample, parsedThreshold.hdf),
    evaluatePwf(parsedSample, parsedThreshold.pwf),
    evaluateOsf(parsedSample, parsedThreshold.osf),
  ];

  return {
    verdicts,
    triggeredModes: verdicts.filter((v) => v.triggered).map((v) => v.mode),
  };
}
