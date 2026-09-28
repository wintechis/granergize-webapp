import { Building } from "../../types.ts";
import {
  DEFAULT_METRIC,
  metricFraming,
  type SelectableMetricKey,
} from "./energyMetric.ts";
import {
  type EnergyByBuildingYear,
  valuesAtYear,
} from "./energyTimeCut.ts";

/**
 * Pure logic behind the map's **trend lens** (Step 3 of `plans/plan-cube-ui.md`):
 * a *content transformation* of the cube that flattens the time axis into a
 * single year-over-year **trend** colour per building — improving / flat /
 * worsening — instead of the absolute efficiency tier the energy lens shows.
 *
 * The trend is read off the cube the app already loads (`useAnnualEnergyByYear`):
 * a building's **two most recent comparable years** (the latest year for which it
 * has a usable intensity, and the most recent earlier one), and the relative
 * change between their energy *intensities* (kWh/m²/a — the same per-floor-area
 * proxy `energyCategory.ts`/`energyTimeCut.ts` use, so size doesn't masquerade as
 * a trend). Lower intensity later = less energy per m² = **improving**.
 *
 * React/Leaflet-free so the categorisation is unit-testable in isolation; the
 * colours, the legend and the lens toggle live in `ExplorePage.tsx`.
 */

export type EnergyTrend = "improving" | "flat" | "worsening" | "unknown";

/**
 * The flat band: a relative change within ±5 % of the prior year's intensity
 * reads as **flat** (year-to-year noise / rounding shouldn't paint a building as
 * a mover). Tighter and every wobble is a "trend"; wider and a real shift is
 * hidden. Expressed as a fraction of the prior intensity so it scales across
 * building types rather than being a fixed kWh/m².
 */
export const TREND_FLAT_BAND = 0.05;

/**
 * Categorise a relative change into a trend. `delta` is the *relative* change
 * `(current - prior) / prior` (a fraction: -0.1 = 10 % lower this year). A
 * non-finite delta (no prior / no comparison) → `"unknown"`; within the flat band
 * → `"flat"`.
 *
 * `betterWhenLower` sets which direction reads as **improving**: for a *consumption*
 * metric less is better, so a fall (delta < 0) improves; for a *generation* metric
 * more is better, so a rise (delta > 0) improves. The flat band is symmetric either
 * way.
 */
export function trendForDelta(
  delta: number | null,
  betterWhenLower = true,
): EnergyTrend {
  if (delta == null || !Number.isFinite(delta)) return "unknown";
  if (Math.abs(delta) <= TREND_FLAT_BAND) return "flat";
  const fell = delta < 0;
  const improved = betterWhenLower ? fell : !fell;
  return improved ? "improving" : "worsening";
}

/**
 * Pick a building's two most recent **comparable** years from its per-year
 * intensities: the latest year carrying a usable intensity (current) and the
 * most recent earlier year that also does (prior). A building with fewer than two
 * such years can't show a trend (`prior` is `null`). Years that have a dataset
 * but no usable intensity (no area / no figure) are skipped — they're not a
 * comparison point.
 *
 * `byYear` maps a year to that building's intensity at it (`null`/absent = no
 * usable figure that year). Returns the two intensities and the years they came
 * from, all `null` when there aren't two comparable years.
 */
export function recentTwoYears(
  byYear: Map<number, number | null>,
): {
  currentYear: number | null;
  priorYear: number | null;
  current: number | null;
  prior: number | null;
} {
  const usable = [...byYear.entries()]
    .filter(([, v]) => v != null && Number.isFinite(v))
    .map(([year, v]) => [year, v as number] as const)
    .sort((a, b) => b[0] - a[0]); // most recent first
  if (usable.length < 2) {
    return usable.length === 1
      ? { currentYear: usable[0][0], priorYear: null, current: usable[0][1], prior: null }
      : { currentYear: null, priorYear: null, current: null, prior: null };
  }
  const [current, prior] = usable;
  return {
    currentYear: current[0],
    priorYear: prior[0],
    current: current[1],
    prior: prior[1],
  };
}

/**
 * A building's trend **and the facts behind it** — the two comparable years and the
 * relative change between them. The trend column's tooltip states those facts, so the
 * distiller returns them rather than only the verdict.
 *
 * Invariants: `delta != null` ⇔ `trend !== "unknown"`, and a non-null `delta` implies
 * both years are non-null. A building with exactly one usable year keeps its
 * `currentYear` (there IS a figure, just nothing to compare it to).
 */
export interface BuildingTrend {
  trend: EnergyTrend;
  currentYear: number | null;
  priorYear: number | null;
  /**
   * `(current - prior) / prior` — a fraction, signed in the **metric's** direction
   * (negative = the figure fell). NOT flipped by `betterWhenLower`: the sign states
   * what happened, `trend` states whether that was an improvement.
   */
  delta: number | null;
}

/**
 * Distil one building's year→value series into its trend: pick the two most recent
 * comparable years, take the relative change, categorise it. `betterWhenLower` picks
 * which direction reads as improving (see {@link trendForDelta}).
 *
 * A non-positive prior can't carry a relative change (division by ~zero), so it yields
 * `"unknown"` with a null delta rather than an infinite one.
 */
export function trendFromSeries(
  byYear: Map<number, number | null>,
  betterWhenLower = true,
): BuildingTrend {
  const { currentYear, priorYear, current, prior } = recentTwoYears(byYear);
  const delta = current == null || prior == null || !(prior > 0)
    ? null
    : (current - prior) / prior;
  return {
    trend: trendForDelta(delta, betterWhenLower),
    currentYear,
    priorYear: delta == null ? null : priorYear,
    delta,
  };
}

/**
 * The per-building trend across the set: for each building, assemble its
 * year→intensity series from the per-year energy cube (reusing `intensitiesAtYear`
 * so the value matches the map's energy lens cell-for-cell), pick its two most
 * recent comparable years, and categorise the change. A building with <2
 * comparable years → `"unknown"` (a neutral marker — honest "can't tell a trend").
 * Each entry carries the two years and the change behind the verdict, so the UI can
 * state them rather than assert an unexplained direction.
 *
 * Unlike the energy lens, a trend is **per building over its own history** — it
 * needs no peer set, so panning doesn't reframe it (every building is judged
 * against its own prior year, not its neighbours).
 */
export function trendForBuildings(
  buildings: Building[],
  energyByBuilding: EnergyByBuildingYear,
  metric: SelectableMetricKey = DEFAULT_METRIC,
): Map<string, BuildingTrend> {
  // All years present across the set; build each building's year→value series for
  // the selected metric (so missing-figure years drop out as nulls, exactly as the
  // map colours them).
  const years = new Set<number>();
  for (const byYear of energyByBuilding.values()) {
    for (const year of byYear.keys()) years.add(year);
  }
  const valueByYear = new Map<number, Map<string, number | null>>();
  for (const year of years) {
    valueByYear.set(year, valuesAtYear(buildings, energyByBuilding, year, metric));
  }

  // Consumption falls = improving; generation rises = improving.
  const betterWhenLower = metricFraming(metric) !== "magnitude";

  const out = new Map<string, BuildingTrend>();
  for (const b of buildings) {
    const series = new Map<number, number | null>();
    for (const [year, values] of valueByYear) {
      series.set(year, values.get(b.id) ?? null);
    }
    out.set(b.id, trendFromSeries(series, betterWhenLower));
  }
  return out;
}
