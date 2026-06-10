import type { EnergyMetricKey } from "../services/rdf/energyDataset.ts";

/**
 * THE annual-metric schema — the one description of the five annual energy
 * metrics a building may carry (`AnnualMetrics` in `energyDataset.ts`). The
 * energy-entry form, the create-view metric checklists and the aggregated-view
 * rendering all derive their labels/units from this table, so adding or
 * renaming a metric happens in exactly one place (three hand-maintained copies
 * once drifted into a checklist offering fields no form captures — heike-4).
 */
export interface AnnualMetricDesc {
  key: EnergyMetricKey;
  /** Short human name ("Electricity"). */
  label: string;
  unit: "kWh" | "m³" | "%";
  /** Compact column-header form ("Renewable %"). */
  short: string;
  /** Display decimals (de-DE formatting). */
  decimals: number;
}

export const ANNUAL_METRICS: AnnualMetricDesc[] = [
  { key: "electricityConsumption", label: "Electricity", unit: "kWh", short: "Electricity", decimals: 0 },
  { key: "heatConsumption", label: "Heat", unit: "kWh", short: "Heat", decimals: 0 },
  { key: "waterConsumption", label: "Water", unit: "m³", short: "Water", decimals: 1 },
  { key: "wastewaterConsumption", label: "Wastewater", unit: "m³", short: "Wastewater", decimals: 1 },
  {
    key: "renewableSelfGeneratedShare",
    label: "Renewable self-generated share",
    unit: "%",
    short: "Renewable %",
    decimals: 1,
  },
];

export function annualMetricDesc(key: string): AnnualMetricDesc | undefined {
  return ANNUAL_METRICS.find((m) => m.key === key);
}

/** "Electricity (kWh)" — the labelled form for checklists, headers and rows.
 * Unknown keys (e.g. the monthly view's "electricity" total) fall back to the
 * capitalised key so nothing renders as a raw camelCase identifier. */
export function annualMetricLabel(key: string): string {
  const d = annualMetricDesc(key);
  if (d) return `${d.label} (${d.unit})`;
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/** The four absolute-consumption metrics (kWh / m³) — what a benchmark
 * aggregates; the share-% metric is a ratio and stays out. */
export const CONSUMPTION_METRIC_KEYS: EnergyMetricKey[] = ANNUAL_METRICS
  .filter((m) => m.unit !== "%")
  .map((m) => m.key);
