import { describe, expect, it } from "vitest";

import {
  DEGRADED_UNRESOLVED_RATE,
  DOWN_UNRESOLVED_RATE,
  deriveHealth,
} from "@/features/assets/health";

/**
 * These thresholds are what stopped the dashboard rendering eight green
 * "Operational" badges next to 111 unresolved faults, so the boundaries are
 * pinned deliberately. If one of these numbers changes it must be a
 * documented decision, not a tuning accident — the derivation is a claim the
 * dashboard makes to a reader.
 */
describe("deriveHealth", () => {
  it("reports OPERATIONAL for a healthy asset", () => {
    // The fleet average is ~1.1% unresolved.
    expect(deriveHealth({ unresolvedCount: 12, readingCount: 1250 })).toBe(
      "OPERATIONAL",
    );
  });

  it("reports DEGRADED once the unresolved rate crosses the threshold", () => {
    // PUMP-201 in the seeded dataset: 46 / 1250 = 3.68%.
    expect(deriveHealth({ unresolvedCount: 46, readingCount: 1250 })).toBe(
      "DEGRADED",
    );
  });

  it("reports DOWN at or above the down threshold", () => {
    expect(deriveHealth({ unresolvedCount: 125, readingCount: 1250 })).toBe(
      "DOWN",
    );
  });

  it("treats the threshold as inclusive", () => {
    const readings = 1000;
    expect(
      deriveHealth({
        unresolvedCount: Math.round(readings * DEGRADED_UNRESOLVED_RATE),
        readingCount: readings,
      }),
    ).toBe("DEGRADED");
    expect(
      deriveHealth({
        unresolvedCount: Math.round(readings * DOWN_UNRESOLVED_RATE),
        readingCount: readings,
      }),
    ).toBe("DOWN");
  });

  it("stays OPERATIONAL just below the degraded threshold", () => {
    // 2.9% unresolved must not trip DEGRADED.
    expect(deriveHealth({ unresolvedCount: 29, readingCount: 1000 })).toBe(
      "OPERATIONAL",
    );
  });

  it("does not divide by zero when an asset has no readings", () => {
    expect(deriveHealth({ unresolvedCount: 0, readingCount: 0 })).toBe(
      "OPERATIONAL",
    );
  });

  it("does not claim a fault verdict when there is no reading evidence", () => {
    // No readings is a data-availability problem, so the derivation declines to
    // assert DEGRADED or DOWN even if unresolved rows somehow exist.
    expect(deriveHealth({ unresolvedCount: 3, readingCount: 0 })).toBe(
      "OPERATIONAL",
    );
  });
});
