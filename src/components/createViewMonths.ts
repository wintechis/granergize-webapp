import type { BuildingType, EnergyDatasetRef } from "../types.ts";
import { isSeriesGranularity } from "../services/rdf/durationUtils.ts";

/**
 * The 15-minute series datasets behind the SELECTED buildings only. The month
 * dropdown must offer exactly the months the view will compute over — months
 * discovered across unselected buildings let the user pick a month with no data
 * in their selection, yielding an empty snapshot (heike-5 #4, the same failure
 * heike-4's data-bearing-months dropdown was introduced to prevent).
 */
export function selectedSeriesRefs(
  available: BuildingType[],
  selectedUris: string[],
): EnergyDatasetRef[] {
  return available
    .filter((b) => selectedUris.includes(b.uri))
    .flatMap((b) =>
      (b.energyDatasets ?? []).filter((r) => isSeriesGranularity(r.granularity))
    );
}

/** Day names (`YYYY-MM-DD`) reduced to their distinct months (`YYYY-MM`), sorted. */
export function monthsFromDays(days: Array<{ day: string }>): string[] {
  return [
    ...new Set(
      days.map(({ day }) => day.substring(0, 7)).filter((m) => m.length === 7),
    ),
  ].sort();
}
