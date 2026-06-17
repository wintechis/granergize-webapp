/**
 * Pure alignment logic behind the **energy × weather overlay** (Step 6a of
 * `plans/plan-cube-ui.md`): a *cross-layer superimpose* of the building's annual
 * energy and a nearby DWD station's annual weather on the **shared year axis**, so
 * consumption can be read against the weather.
 *
 * This module is React/fetch-free — it takes the years the energy chart already
 * plots and the wrapper's annual {@link WeatherAnnualValue}s and folds them
 * into one row-per-year overlay. The fetch (`linkedWeather.ts`, station picking) and
 * the rendering (the second Recharts axis) live in the chart component; only the
 * alignment is here so it stays unit-testable with no network.
 *
 * First cut = **mean temperature** (directly available from the wrapper). HDD
 * (heating-degree-days) is a deliberate follow-up: it needs a base-temperature
 * choice (a design decision), so it is NOT derived here.
 */

/** One weather observation as the adapter returns it: an ISO date + a value. The
 * adapter's `Value` carries more, but alignment needs only these two. */
export interface WeatherAnnualValue {
  /** ISO date string; the year is taken from it (annual values land on a year). */
  date: string;
  /** The measured figure (e.g. mean temperature in °C). */
  value: number;
}

/** A year paired with its energy figure (may be absent) and weather figure (may be
 * absent) — the shape a dual-axis chart row needs. */
export interface OverlayPoint {
  year: number;
  /** The energy figure for that year, or `null` when the building has none. */
  energy: number | null;
  /** The weather figure (mean temperature) for that year, or `null` when the
   * station has no value that year. */
  weather: number | null;
}

/**
 * Fold the adapter's annual weather values into a `year → value` map, taking the
 * year off each ISO `date`. When a station reports more than one value for the same
 * year (it shouldn't for an annual parameter, but the data is external), the LAST
 * one wins — deterministic, and good enough for an overlay. A non-finite value is
 * dropped (treated as "no figure that year").
 */
export function weatherByYear(
  values: readonly WeatherAnnualValue[],
): Map<number, number> {
  const out = new Map<number, number>();
  for (const v of values) {
    const year = new Date(v.date).getFullYear();
    if (!Number.isFinite(year) || !Number.isFinite(v.value)) continue;
    out.set(year, v.value);
  }
  return out;
}

/**
 * Align energy and weather onto one row-per-year series for the overlay chart.
 *
 * The axis is the **union** of the years the energy chart plots and the years the
 * station reports, ascending — so a year present on only one layer still appears
 * (with `null` on the missing layer; the chart renders that as a gap, never a
 * fabricated 0). `energyByYear` is the energy figure per year as the chart already
 * has it (e.g. the per-year consumption the annual view plots); a year absent from
 * it is `energy: null`.
 *
 * Pure: same inputs → same output, no ordering surprises (years sorted ascending).
 */
export function alignEnergyWeather(
  energyByYear: ReadonlyMap<number, number>,
  weatherByYearMap: ReadonlyMap<number, number>,
): OverlayPoint[] {
  const years = new Set<number>();
  for (const y of energyByYear.keys()) years.add(y);
  for (const y of weatherByYearMap.keys()) years.add(y);
  return [...years]
    .sort((a, b) => a - b)
    .map((year) => ({
      year,
      energy: energyByYear.has(year) ? energyByYear.get(year)! : null,
      weather: weatherByYearMap.has(year)
        ? weatherByYearMap.get(year)!
        : null,
    }));
}

/**
 * Whether an aligned overlay has at least one year where BOTH layers carry a
 * figure — the only case where the overlay is *informative* (you can read energy
 * against weather). When false (energy and weather never co-occur), the caller
 * shows the weather caveat / "no overlapping years" note rather than a chart that
 * looks aligned but shares no point.
 */
export function hasOverlap(points: readonly OverlayPoint[]): boolean {
  return points.some((p) => p.energy != null && p.weather != null);
}
