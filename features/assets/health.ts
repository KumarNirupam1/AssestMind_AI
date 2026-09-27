/**
 * Derived asset health.
 *
 * `Asset.status` is a stored, operator-set field and the seed writes
 * `OPERATIONAL` to every row. Displaying it as "Asset health" alongside the
 * fault counts in the same row was actively misleading: 111 unresolved
 * faults rendered next to eight green "Operational" badges.
 *
 * Health is therefore *derived at read time* from the fault evidence that is
 * already in the query, and shown in its own column. The stored status is
 * still returned for the detail page, where an operator-set state such as
 * MAINTENANCE is meaningful, but it is not presented as a health signal.
 *
 * This is deliberately not the Phase 2 guardrail engine. Those rules reason
 * about individual readings; this only ranks an asset by how much of its
 * recent output failed and has not been closed out.
 */

/** Fleet-wide unresolved rate is ~1.1%, so 3% is roughly triple normal. */
export const DEGRADED_UNRESOLVED_RATE = 0.03;

/** At 10% of readings open the asset is effectively not producing. */
export const DOWN_UNRESOLVED_RATE = 0.1;

export type DerivedHealth = "OPERATIONAL" | "DEGRADED" | "DOWN";

export function deriveHealth(input: {
  unresolvedCount: number;
  readingCount: number;
}): DerivedHealth {
  if (input.readingCount <= 0) {
    // No readings is a data-availability problem, not a machine fault, and
    // there is no evidence to support a degraded verdict.
    return "OPERATIONAL";
  }

  const rate = input.unresolvedCount / input.readingCount;

  if (rate >= DOWN_UNRESOLVED_RATE) return "DOWN";
  if (rate >= DEGRADED_UNRESOLVED_RATE) return "DEGRADED";
  return "OPERATIONAL";
}
