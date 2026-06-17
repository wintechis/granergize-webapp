import { BuildingType } from "../../types.ts";
import { type AnnualMetrics, type EnergyMetricKey } from "../rdf/energyDataset.ts";
import { categoriserFor, type EnergyCategory } from "./energyCategory.ts";
import {
  DEFAULT_METRIC,
  magnitudeCategoriserFor,
  type MagnitudeBucket,
  metricFraming,
  metricValueAtYear,
} from "./energyMetric.ts";

/**
 * Pure logic behind the map's **interactive time-cut** (the year slider — Step 1
 * of `plans/plan-cube-ui.md`) generalised over the **measure axis** (the
 * cross-cutting metric selector). The energy lens normally categorises the latest
 * accessible year; the slider re-cuts the cube at a *chosen* year, and the metric
 * selector re-cuts it on a *chosen* observed property. Everything here is
 * React/Leaflet-free so the year-range derivation and the per-year categorisation
 * are unit-testable in isolation; the colours, the slider/selector widgets and the
 * animation timer live in `ExplorePage.tsx`.
 *
 * The per-(building, year) value is the **selected metric** read off that year's
 * `AnnualMetrics` via `metricValueAtYear` (intensity for consumption, absolute
 * magnitude for generation — see `energyMetric.ts`), keyed by the year a building's
 * annual dataset covers (`EnergyDatasetRef.year`).
 */

/** A building's reachable annual metrics keyed by the year they cover. */
export type EnergyByYear = Map<number, AnnualMetrics>;

/** Per-building annual metrics keyed by building id, each a year→metrics map. */
export type EnergyByBuildingYear = Map<string, EnergyByYear>;

/**
 * The selectable year range for the slider: the **union of reachable buildings'**
 * annual dataset years (ascending, de-duplicated). "Reachable" — only the years
 * actually present in the supplied per-building maps, not a fixed range — so a year
 * always has at least one building behind it (the plan's "partiality: reachable,
 * not all"). Empty when no building carries any annual data.
 */
export function selectableYears(
  energyByBuilding: EnergyByBuildingYear,
): number[] {
  const years = new Set<number>();
  for (const byYear of energyByBuilding.values()) {
    for (const year of byYear.keys()) years.add(year);
  }
  return [...years].sort((a, b) => a - b);
}

/**
 * Pick the year to show first: the latest selectable year (the map's existing
 * latest-year behaviour), or `null` when nothing is selectable.
 */
export function defaultYear(years: number[]): number | null {
  return years.length === 0 ? null : years[years.length - 1];
}

/**
 * Clamp a requested year (e.g. one decoded from the URI) to the selectable set:
 * the year itself if present, else the nearest selectable year, else `null` when
 * none are selectable. Keeps a stale/shared link from selecting a year no building
 * has.
 */
export function clampYear(years: number[], requested: number | null): number | null {
  if (years.length === 0) return null;
  if (requested == null) return defaultYear(years);
  if (years.includes(requested)) return requested;
  // Nearest by absolute distance (ties → the earlier year, which sorts first).
  return years.reduce((best, y) =>
    Math.abs(y - requested) < Math.abs(best - requested) ? y : best
  );
}

/**
 * The per-building value (for the selected metric) **at the selected year** — the
 * value the lens categorises. A building with no annual figure for that metric/year
 * yields `null` (rendered as the neutral "no data" marker for that cut), so the map
 * honestly shows which buildings carry the chosen metric in the chosen year.
 */
export function valuesAtYear(
  buildings: BuildingType[],
  energyByBuilding: EnergyByBuildingYear,
  year: number | null,
  metric: EnergyMetricKey = DEFAULT_METRIC,
): Map<string, number | null> {
  const out = new Map<string, number | null>();
  for (const b of buildings) {
    const metrics = year == null ? undefined : energyByBuilding.get(b.id)?.get(year);
    out.set(b.id, metricValueAtYear(b, metrics, metric));
  }
  return out;
}

/** Back-compat alias — the consumption-intensity value at a year (default metric). */
export const intensitiesAtYear = valuesAtYear;

/** The band a lens places a building in: an efficiency tier (consumption framing) or
 * a neutral magnitude bucket (generation framing). `"none"` is shared by both. */
export type LensBand = EnergyCategory | MagnitudeBucket;

/** The lens result: the per-building values, a `band(id)` lookup, and which framing
 * produced the bands (so the marker/legend pick the right palette and labels). */
export interface YearLens {
  values: Map<string, number | null>;
  band: (id: string) => LensBand;
  framing: ReturnType<typeof metricFraming>;
}

/**
 * The categoriser for a given year + metric: build the peer thresholds from the
 * values present **at that year** (so panning/year-scrubbing both re-frame the
 * comparison), then place each building. Consumption metrics use the efficiency
 * terciles (`categoriserFor`); generation uses the neutral magnitude terciles
 * (`magnitudeCategoriserFor`). The categoriser is parameterised by year AND metric,
 * not duplicated.
 */
export function yearLens(
  buildings: BuildingType[],
  visibleIds: ReadonlySet<string>,
  energyByBuilding: EnergyByBuildingYear,
  year: number | null,
  metric: EnergyMetricKey = DEFAULT_METRIC,
): YearLens {
  const values = valuesAtYear(buildings, energyByBuilding, year, metric);
  const peers: number[] = [];
  for (const [id, v] of values) {
    if (v != null && visibleIds.has(id)) peers.push(v);
  }
  const framing = metricFraming(metric);
  const classify = framing === "magnitude"
    ? magnitudeCategoriserFor(peers)
    : categoriserFor(peers);
  return {
    values,
    band: (id) => classify(values.get(id) ?? null),
    framing,
  };
}
