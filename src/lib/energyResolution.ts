import type { EnergyDatasetRef } from "../types.ts";
import { isSeriesGranularity } from "../services/rdf/durationUtils.ts";

/**
 * A building's energy dataset refs partitioned by declared granularity kind
 * (`isSeriesGranularity`): dated durations (`P1Y`, `P1M`, …) are bulk-loaded
 * aggregates; time-only durations (`PT15M`, `PT1H`) are lazy-loaded series.
 * Render surfaces dispatch on this split — and when both kinds are present,
 * the user picks the view (`EnergyResolutionSwitch`), never the app.
 */
export interface EnergyDatasetSplit {
  aggregates: EnergyDatasetRef[];
  series: EnergyDatasetRef[];
}

export function splitEnergyDatasets(
  datasets: EnergyDatasetRef[] | undefined,
): EnergyDatasetSplit {
  const aggregates: EnergyDatasetRef[] = [];
  const series: EnergyDatasetRef[] = [];
  for (const d of datasets ?? []) {
    (isSeriesGranularity(d.granularity) ? series : aggregates).push(d);
  }
  return { aggregates, series };
}
