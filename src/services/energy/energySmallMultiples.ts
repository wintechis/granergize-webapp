import { BuildingType } from "../../types.ts";
import { type EnergyMetricKey } from "../rdf/energyDataset.ts";
import { categoriserFor } from "./energyCategory.ts";
import {
  DEFAULT_METRIC,
  magnitudeCategoriserFor,
  type MetricFraming,
  metricFraming,
} from "./energyMetric.ts";
import {
  type EnergyByBuildingYear,
  type LensBand,
  selectableYears,
  valuesAtYear,
} from "./energyTimeCut.ts";

/**
 * Pure logic behind the **small-multiples "compare years" view** (Step 4 of
 * `plans/plan-cube-ui.md`): the time-juxtaposing collection guise. Where the
 * map's time-cut slider (Step 1) shows the set at ONE year and the cross-building
 * matrix (Step 2) packs every (building, year) into a grid, this lays out one
 * compact mini-panel PER YEAR side by side — so several years' building sets are
 * seen at once.
 *
 * The single load-bearing rule is a **shared scale across panels**: where the
 * matrix re-frames the efficiency terciles *per column* (each year against its
 * own peers), small multiples are only comparable if every panel reads against
 * **one** scale. So the categoriser here is built ONCE from the visible
 * intensities pooled across ALL years, then applied to every panel — a building
 * the same colour in two panels really has comparable intensity. This reuses the
 * exact `energyTimeCut` primitives the map and matrix use (`intensitiesAtYear`
 * for the per-year value, `categoriserFor` for the tier), so a (building, year)
 * placed here agrees with the cube elsewhere up to the choice of peer pool.
 *
 * React/MUI-free so the slicing and shared-scale derivation are unit-testable in
 * isolation; the panel layout and colours live in
 * `components/SmallMultiplesPanel.tsx`.
 */

/** One building's value within a year panel. */
export interface PanelBuilding {
  building: BuildingType;
  /** The selected metric's value at this panel's year (per-m² intensity for
   * consumption, absolute magnitude for generation), or `null` for no data. */
  value: number | null;
  /** Band under the SHARED (cross-year) scale — an efficiency tier (consumption) or
   * a neutral magnitude bucket (generation); `"none"` when there is no value. */
  band: LensBand;
}

/** One year's mini-panel: the year plus a slot per supplied building. */
export interface YearPanel {
  year: number;
  buildings: PanelBuilding[];
}

/**
 * The shared value scale every panel reads against: the pooled (min, max) of all
 * the visible intensities across every year, for the per-building bar lengths.
 * `null` when nothing is reachable.
 */
export interface SharedScale {
  min: number;
  max: number;
}

/** A year-by-year set of panels plus the one scale they all share. */
export interface SmallMultiples {
  /** The year panels, ascending — the union of reachable buildings' years. */
  panels: YearPanel[];
  /** The shared bar scale, or `null` when no building carries any annual energy. */
  scale: SharedScale | null;
  /** Which framing coloured the bars (tier vs magnitude), from the selected metric. */
  framing: MetricFraming;
}

/**
 * Shape `buildings × years → one panel per year, on a shared scale`. The years are
 * the union of the reachable buildings' dataset years (`selectableYears`,
 * ascending); each panel carries one slot per supplied building (a building with
 * no dataset that year gets `value: null`, `tier: "none"`, so a hole reads as a
 * hole, not a zero).
 *
 * Both the tier categoriser AND the bar scale are derived ONCE from the
 * intensities pooled across all years (restricted to `visibleIds` so an off-screen
 * building doesn't skew the comparison — defaults to every supplied building), so
 * the panels are mutually comparable. Building order is preserved within every
 * panel.
 *
 * `panels` is empty (and `scale` is `null`) when no building carries any annual
 * energy.
 */
export function buildSmallMultiples(
  buildings: BuildingType[],
  energyByBuilding: EnergyByBuildingYear,
  visibleIds: ReadonlySet<string> = new Set(buildings.map((b) => b.id)),
  metric: EnergyMetricKey = DEFAULT_METRIC,
): SmallMultiples {
  const years = selectableYears(energyByBuilding);

  // One value map per year for the selected metric (reused for the pooled scale AND
  // each panel).
  const perYearValues = new Map<number, Map<string, number | null>>(
    years.map((year) => [
      year,
      valuesAtYear(buildings, energyByBuilding, year, metric),
    ]),
  );

  // Pool every VISIBLE building's value across ALL years — the single scale.
  const pooled: number[] = [];
  for (const values of perYearValues.values()) {
    for (const [id, v] of values) {
      if (v != null && visibleIds.has(id)) pooled.push(v);
    }
  }

  // One categoriser for the whole view (cross-year terciles), so a band means the
  // same thing in every panel. The framing (tier vs neutral magnitude) follows the
  // selected metric.
  const framing = metricFraming(metric);
  const classify = framing === "magnitude"
    ? magnitudeCategoriserFor(pooled)
    : categoriserFor(pooled);

  const scale: SharedScale | null = pooled.length === 0 ? null : {
    min: Math.min(...pooled),
    max: Math.max(...pooled),
  };

  const panels: YearPanel[] = years.map((year) => {
    const values = perYearValues.get(year)!;
    return {
      year,
      buildings: buildings.map((building) => {
        const value = values.get(building.id) ?? null;
        return { building, value, band: classify(value) };
      }),
    };
  });

  return { panels, scale, framing };
}

/**
 * Map an intensity to a `0..1` fraction of the shared scale, for a bar length.
 * `null`/no-scale → `0` (an empty bar). A degenerate scale (min === max) puts
 * every present value at full length, so a single-value view still reads.
 */
export function barFraction(
  value: number | null,
  scale: SharedScale | null,
): number {
  if (value == null || scale == null) return 0;
  if (scale.max <= scale.min) return 1;
  const frac = (value - scale.min) / (scale.max - scale.min);
  return Math.max(0, Math.min(1, frac));
}
