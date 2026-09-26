/** Display helpers. The database stores Kelvin; the UI shows Celsius. */

export function kelvinToCelsius(k: number): number {
  return k - 273.15;
}

export function formatKelvinAsCelsius(k: number, digits = 1): string {
  return `${kelvinToCelsius(k).toFixed(digits)} °C`;
}

export function formatNumber(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("en-GB", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatInteger(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("en-GB", { maximumFractionDigits: 0 });
}

export function formatPercent(fraction: number, digits = 2): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

const DATE_FMT = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const DATETIME_FMT = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

export function formatDate(d: Date | null | undefined): string {
  return d ? DATE_FMT.format(d) : "—";
}

export function formatDateTime(d: Date | null | undefined): string {
  return d ? `${DATETIME_FMT.format(d)} UTC` : "—";
}

export const MODE_LABEL: Record<string, string> = {
  TWF: "Tool wear",
  HDF: "Heat dissipation",
  PWF: "Power",
  OSF: "Overstrain",
  RNF: "Random",
};

export const MODE_DESCRIPTION: Record<string, string> = {
  TWF: "Tool wear failure",
  HDF: "Heat dissipation failure",
  PWF: "Power failure",
  OSF: "Overstrain failure",
  RNF: "Random failure",
};

export const STATUS_LABEL: Record<string, string> = {
  OPERATIONAL: "Operational",
  DEGRADED: "Degraded",
  MAINTENANCE: "In maintenance",
  DOWN: "Down",
};

export const SEVERITY_LABEL: Record<string, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  CRITICAL: "Critical",
};

export const MAINTENANCE_TYPE_LABEL: Record<string, string> = {
  PREVENTIVE: "Preventive",
  CORRECTIVE: "Corrective",
  INSPECTION: "Inspection",
  CALIBRATION: "Calibration",
};

export const CRITICALITY_LABEL: Record<string, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  CRITICAL: "Critical",
};
