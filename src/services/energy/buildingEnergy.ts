import type { Building, Energy } from "../../types.ts";
import type { PodGateway } from "../pod/podGateway.ts";
import { isSeriesGranularity } from "../rdf/durationUtils.ts";
import { CONSUMPTION_METRIC_KEYS } from "../../constants/annualMetrics.ts";
import { fetchEnergyDatasetShared } from "./energyDatasetCache.ts";

/**
 * One building's energy as a per-building resource read — the unit the `useEnergy`
 * `useQueries` selector fans out over, and the loop `loadEnergy` runs for the headless
 * fold. Both share this so the per-building shape can't drift between the app and the
 * orchestrator. See `plans/plan-ldp-query-layer.md`.
 */

/** Arithmetic mean of a non-empty list. */
function meanOf(values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

/**
 * Mean each metric bucket of a `metric → samples` map, dropping any bucket with
 * fewer than `minCount` samples (the operator averages need ≥2 so a lone
 * building isn't published as its own benchmark — see {@link computeEnergyAverages}).
 */
function meanByMetric(
  buckets: Record<string, number[]>,
  minCount = 1,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const metric in buckets) {
    if (buckets[metric].length < minCount) continue;
    out[metric] = meanOf(buckets[metric]);
  }
  return out;
}

/**
 * A per-building fingerprint of the building's energy dataset links
 * (`year-granularity-scenario`, sorted) — the per-building replacement for the
 * whole-set `energyKeyFor`. Goes in the per-building query key so adding/removing a
 * year refetches that one building's energy (the building IRI is already in the key).
 */
export function buildingEnergyKeyFor(building: Building): string {
  return (building.energyDatasets ?? [])
    .map((d) => `${d.year}-${d.granularity}-${d.scenario}`)
    .sort()
    .join(",");
}

/**
 * The building's latest READABLE actual-annual energy as an `Energy`, or `null` when
 * it has none. Newest-first with fallback: a per-year share can grant only some years,
 * so the recipient's fetch of the newest LINKED year can 403 while an older granted year
 * is readable — fall through to the next-newest instead of dropping the building. Each
 * dataset is read through the shared per-dataset cache, so it's read-once with every
 * other consumer (map fold, compute, detail pane).
 */
export async function resolveBuildingEnergy(
  building: Building,
  gateway: PodGateway,
): Promise<Energy | null> {
  const refs = (building.energyDatasets ?? [])
    .filter(
      (r) =>
        r.scenario === "actual" && !isSeriesGranularity(r.granularity) &&
        // Building-level only: per-unit observations (a <#pv>/<#battery>/<#chp>
        // feature-of-interest) are a separate series, not part of the building total.
        !r.featureOfInterest,
    )
    .sort((a, b) => b.year - a.year); // newest first

  for (const ref of refs) {
    try {
      const ds = await fetchEnergyDatasetShared(ref.uri, gateway);
      if (!ds?.metrics) continue;
      // Canonical, vocab-keyed energy: `energyNeed` mirrors the AnnualMetrics keys 1:1
      // with the `cons:*` observed-property IRIs. Display labels are derived at render.
      const energyNeed: Record<string, number> = {};
      for (const key of CONSUMPTION_METRIC_KEYS) {
        const v = ds.metrics[key];
        if (v !== undefined) energyNeed[key] = v;
      }
      if (Object.keys(energyNeed).length === 0) return null;
      return {
        id: building.id,
        uri: building.uri as string,
        year: ref.year,
        energyNeed,
        energyGeneration: {},
        energyStorage: {},
        energyDistribution: {},
        energyTransfer: {},
        energyUsage: {},
        environmentalFactor: {},
      };
    } catch (error) {
      console.error(
        `Failed to load energy ${ref.year} for building ${building.id}:`,
        error,
      );
    }
  }
  return null;
}

/**
 * The portfolio + operator (Betreiber) averages derived from a set of resolved
 * per-building energies. Pure: the derive-at-edge selector `useEnergy`'s `combine`
 * runs, and the same math `loadEnergy` runs for the headless fold.
 * - **portfolio** — mean per metric across the user's OWN buildings only (`!isShared`),
 *   the honest reference the energy view shows.
 * - **operator** — mean per metric per `operatedBy`, published only when ≥2 buildings
 *   contribute: a single-building "mean" IS that building's own value, which would render
 *   the own figure as a benchmark and win the comparison-reference precedence, silently
 *   disabling the deviation tint.
 */
export function computeEnergyAverages(
  entries: ReadonlyArray<{ building: Building; energy: Energy }>,
): {
  portfolioAverages: Record<string, number>;
  operatorAverages: Record<string, Record<string, number>>;
} {
  const portfolioAggregatedValues: Record<string, number[]> = {};
  const operatorAggregatedValues: Record<string, Record<string, number[]>> = {};

  for (const { building, energy } of entries) {
    for (const [prop, val] of Object.entries(energy.energyNeed)) {
      if (val === undefined) continue;
      if (!building.isShared) {
        (portfolioAggregatedValues[prop] ??= []).push(val);
      }
      const operator = building.operatedBy;
      if (!operator || typeof operator !== "string") continue;
      ((operatorAggregatedValues[operator] ??= {})[prop] ??= []).push(val);
    }
  }

  const portfolioAverages = meanByMetric(portfolioAggregatedValues);
  const operatorAverages: Record<string, Record<string, number>> = {};
  for (const operator in operatorAggregatedValues) {
    const perMetric = meanByMetric(operatorAggregatedValues[operator], 2);
    if (Object.keys(perMetric).length > 0) operatorAverages[operator] = perMetric;
  }
  return { portfolioAverages, operatorAverages };
}
