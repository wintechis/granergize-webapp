import type { EnergyMetricKey } from "../services/energy/energyDataset.ts";
import type { MessageId } from "../lib/messages.ts";
import { label as vocabLabel } from "../services/rdf/vocabLabels.ts";
import type { Lang } from "../lib/language.ts";
import { CONSUMPTION_NS } from "../services/rdf/vocabularies.ts";

/**
 * THE annual-metric schema — the one description of the five annual energy
 * metrics a building may carry (`AnnualMetrics` in `energyDataset.ts`). The
 * energy-entry form, the create-view metric checklists and the aggregated-view
 * rendering all derive their labels/units from this table, so adding or
 * renaming a metric happens in exactly one place (three hand-maintained copies
 * once drifted into a checklist offering fields no form captures — heike-4).
 *
 * Display labels are NOT stored here: the full metric label comes from the
 * vocab (`consumption.ttl`, de/en/fr) via {@link metricLabel}; only the compact
 * column-header abbreviation — UI chrome with no vocab term — is a catalog id.
 */
export interface AnnualMetricDesc {
  key: EnergyMetricKey;
  unit: "kWh" | "m³" | "%";
  /** Catalog id for the compact column-header abbreviation ("Renewable %"). */
  shortId: MessageId;
  /** Display decimals (de-DE formatting). */
  decimals: number;
}

export const ANNUAL_METRICS: AnnualMetricDesc[] = [
  { key: "electricityConsumption", unit: "kWh", shortId: "metricShortElectricity", decimals: 0 },
  { key: "heatConsumption", unit: "kWh", shortId: "metricShortHeat", decimals: 0 },
  { key: "waterConsumption", unit: "m³", shortId: "metricShortWater", decimals: 1 },
  { key: "wastewaterConsumption", unit: "m³", shortId: "metricShortWastewater", decimals: 1 },
  { key: "renewableSelfGeneratedShare", unit: "%", shortId: "metricShortRenewable", decimals: 1 },
  { key: "electricityGeneration", unit: "kWh", shortId: "metricShortGeneration", decimals: 0 },
];

export function annualMetricDesc(key: string): AnnualMetricDesc | undefined {
  return ANNUAL_METRICS.find((m) => m.key === key);
}

/** The metric's full display label from the vocab (`consumption.ttl`) in the
 * active language — e.g. "Electricity consumption". The metric key (camelCase)
 * names its vocab class IRI (PascalCase) under CONSUMPTION_NS; an unknown key
 * resolves to its own local-name fragment (the `vocabLabel` fallback). */
export function metricLabel(key: string, lang?: Lang): string {
  return vocabLabel(`${CONSUMPTION_NS}${key.charAt(0).toUpperCase()}${key.slice(1)}`, lang);
}

/** "Electricity consumption (kWh)" — the labelled form for checklists, headers
 * and rows. Unknown keys (e.g. the monthly view's "electricity" total) fall back
 * to the capitalised key so nothing renders as a raw camelCase identifier. */
export function annualMetricLabel(key: string, lang?: Lang): string {
  const d = annualMetricDesc(key);
  if (d) return `${metricLabel(key, lang)} (${d.unit})`;
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/** The four absolute-consumption metrics (kWh / m³) — what a benchmark
 * aggregates; the share-% metric is a ratio and generation is not a
 * consumption, so both stay out. */
export const CONSUMPTION_METRIC_KEYS: EnergyMetricKey[] = ANNUAL_METRICS
  .filter((m) => m.unit !== "%" && m.key !== "electricityGeneration")
  .map((m) => m.key);
