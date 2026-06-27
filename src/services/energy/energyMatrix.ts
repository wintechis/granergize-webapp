import { BuildingType } from "../../types.ts";
import { type EnergyMetricKey } from "../energy/energyDataset.ts";
import { DEFAULT_METRIC, type MetricFraming, metricFraming } from "./energyMetric.ts";
import {
  type EnergyByBuildingYear,
  type LensBand,
  selectableYears,
  valuesAtYear,
  yearLens,
} from "./energyTimeCut.ts";

/**
 * Pure logic behind the **cross-building space-cut panel** (Step 2 of
 * `plans/plan-cube-ui.md`): the "buildings × time" collection guise. Where the
 * map's time-cut slider (Step 1) shows the whole set at ONE year, this flattens
 * the cube the other way — every building (rows) against every reachable year
 * (columns), each cell carrying that building-year's value for the **selected
 * metric** and the band it falls in (an efficiency tier for consumption, a neutral
 * magnitude bucket for generation). Scan many buildings' temporal evolution at once.
 *
 * React/MUI-free so the shaping is unit-testable in isolation; the heatmap grid,
 * the cell colours and the (building, year) navigation live in
 * `components/observation/ObservationsMatrix.tsx`. The per-cell value and band come from the SAME
 * `energyTimeCut` primitives the map uses (`valuesAtYear` for the value, `yearLens`
 * for the band), so the panel and the map agree cell-for-cell.
 */

/** One (building, year) cell. A year a building has no figure for is a GAP. */
export interface MatrixCell {
  year: number;
  /** The selected metric's value at that year (per-m² intensity for consumption,
   * absolute magnitude for generation), or `null` for a gap / missing figure. */
  value: number | null;
  /** The band the value falls in — an efficiency tier (consumption) or a neutral
   * magnitude bucket (generation); `"none"` for a gap. */
  band: LensBand;
}

/** One building's row: the building plus a cell per ordered year column. */
export interface MatrixRow {
  building: BuildingType;
  cells: MatrixCell[];
}

/** The whole space-cut: ordered year columns + a row per building. */
export interface EnergyMatrix {
  /** The year columns, ascending — the union of reachable buildings' years. */
  years: number[];
  rows: MatrixRow[];
  /** Which framing coloured the cells (so the panel picks tier vs magnitude
   * palette/legend), from the selected metric. */
  framing: MetricFraming;
}

/**
 * Shape `buildings × years → matrix`. The year columns are the union of the
 * reachable buildings' dataset years (`selectableYears`, ascending); every row
 * carries one cell per column (a building with no dataset for a column year gets
 * a GAP cell — `value: null`, `tier: "none"` — so the grid stays rectangular and
 * a hole reads as a hole, not a zero).
 *
 * The tier of a cell is computed **per column against that year's visible peer
 * set** (the same per-year tercile framing the map uses), so a building reads as
 * efficient/typical/inefficient relative to its peers IN THAT YEAR — the panel
 * and the map colour identically at a shared (building, year). `visibleIds`
 * scopes the peer set (defaults to every supplied building when omitted).
 *
 * Rows preserve the supplied building order; `years` is empty (and every row's
 * `cells` empty) when no building carries any annual energy.
 */
export function buildEnergyMatrix(
  buildings: BuildingType[],
  energyByBuilding: EnergyByBuildingYear,
  visibleIds: ReadonlySet<string> = new Set(buildings.map((b) => b.id)),
  metric: EnergyMetricKey = DEFAULT_METRIC,
): EnergyMatrix {
  const years = selectableYears(energyByBuilding);

  // One categoriser + value map per year column (terciles per year), reused across
  // every row so the thresholds are computed once per column, not per cell.
  const perYear = years.map((year) => ({
    year,
    values: valuesAtYear(buildings, energyByBuilding, year, metric),
    band: yearLens(buildings, visibleIds, energyByBuilding, year, metric).band,
  }));

  const rows: MatrixRow[] = buildings.map((building) => ({
    building,
    cells: perYear.map(({ year, values, band }) => {
      const value = values.get(building.id) ?? null;
      return { year, value, band: value == null ? "none" : band(building.id) };
    }),
  }));

  return { years, rows, framing: metricFraming(metric) };
}
