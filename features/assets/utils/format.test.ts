import { describe, expect, it } from "vitest";

import {
  formatDate,
  formatDateTime,
  formatInteger,
  formatNumber,
  formatPercent,
  kelvinToCelsius,
} from "@/features/assets/utils/format";

/**
 * The dataset stores Kelvin and the UI shows Celsius, so the conversion is on
 * the critical path for every temperature the agent will ever reason about.
 */
describe("kelvinToCelsius", () => {
  it("converts absolute zero", () => {
    expect(kelvinToCelsius(0)).toBeCloseTo(-273.15, 10);
  });

  it("converts freezing", () => {
    expect(kelvinToCelsius(273.15)).toBeCloseTo(0, 10);
  });

  it("converts the AI4I process temperature band", () => {
    // The dataset's process temperatures sit around 300-310 K.
    expect(kelvinToCelsius(305.7)).toBeCloseTo(32.55, 10);
  });
});

describe("formatNumber", () => {
  it("rounds to the requested precision", () => {
    expect(formatNumber(1234.5678, 2)).toBe("1,234.57");
  });

  it("renders an em dash for null so the UI never shows NaN", () => {
    expect(formatNumber(null)).toBe("—");
    expect(formatNumber(undefined)).toBe("—");
  });
});

describe("formatInteger", () => {
  it("drops the decimal part", () => {
    expect(formatInteger(1042.9)).toBe("1,043");
  });

  it("renders an em dash for null", () => {
    expect(formatInteger(null)).toBe("—");
  });
});

describe("formatPercent", () => {
  it("treats the input as a fraction", () => {
    expect(formatPercent(0.0333, 2)).toBe("3.33%");
  });

  it("does not round 100% down to 99%", () => {
    expect(formatPercent(1, 0)).toBe("100%");
  });
});

describe("date formatting", () => {
  it("formats in UTC regardless of the host timezone", () => {
    // A date-only value must not shift a day because the server is in
    // Asia/Karachi and CI is in UTC.
    expect(formatDate(new Date("2026-01-26T00:00:00.000Z"))).toBe("26 Jan 2026");
  });

  it("appends UTC to timestamps", () => {
    expect(formatDateTime(new Date("2026-01-26T09:30:00.000Z"))).toContain("UTC");
  });

  it("renders an em dash for missing dates", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDateTime(undefined)).toBe("—");
  });
});
