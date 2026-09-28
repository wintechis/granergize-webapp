import {
  clampMetric,
  DEFAULT_METRIC,
  type SelectableMetricKey,
} from "../energy/energyMetric.ts";
import { clampYear } from "../energy/energyTimeCut.ts";
import { type PivotRowLevel } from "./pivot.ts";
import {
  DEFAULT_ROWS,
  inToParams,
  resolveIn,
  resolveRows,
  rowsToParams,
} from "./observationsAxes.ts";

/**
 * The **cube coordinate** — the one place the analytical surface's "where am I in the
 * cube" vocabulary lives (Step 1 of `plans/plan-cube-centered-ui.md`). A screen that
 * renders cells is a coordinate (this module) plus a projection (`?view=`,
 * `observationsAxes.ts`); switching projections never moves the coordinate, so every
 * projection must read the SAME resolved values — hence one resolver, not a per-view
 * decode.
 *
 * Nothing here is new logic: it COMPOSES the existing pure resolvers — `clampMetric`
 * (`energy/energyMetric.ts`), `clampYear` (`energy/energyTimeCut.ts`), `resolveRows` /
 * `resolveIn` (`observationsAxes.ts`) — into one read and their inverses into one set
 * of serializers. React-free → Tier-1 testable, like the axis modules it wraps.
 *
 * The URI *is* the coordinate (`notes/ui-state.md`): every part is a query param whose
 * default is encoded as absence, written with `setSearchParams`' callback form so an
 * axis only ever sets its own keys.
 */

/** Where the view sits in the cube: the measure (`?m=`), the time cut (`?y=`), the
 *  feature level the rows are rolled up to (`?rows=`) and the region the grid is
 *  confined to (`?in=`). */
export interface CubeCoordinate {
  /** The observed property the cells carry (the measure axis). */
  readonly metric: SelectableMetricKey;
  /** The held year — the time cut the map bands at and the grids mark. `null` when no
   *  year is reachable (an empty cube). */
  readonly year: number | null;
  /** The feature level of the rows: buildings, or an AGS roll-up level. */
  readonly rows: PivotRowLevel;
  /** The drill-down scope (an AGS prefix), or `null` for the unscoped cube. */
  readonly scope: string | null;
}

/** The coordinate an empty URI resolves to over an empty cube — the reference point
 *  the serializers omit from the URI. */
export const DEFAULT_COORDINATE: CubeCoordinate = {
  metric: DEFAULT_METRIC,
  year: null,
  rows: DEFAULT_ROWS,
  scope: null,
};

/** Read the measure axis from `?m=`; an unknown/stale value falls back to the default
 *  metric, so a shared link can never select a metric the views can't lens on. */
export function resolveMetric(params: URLSearchParams): SelectableMetricKey {
  return clampMetric(params.get("m"));
}

/** The year as REQUESTED by the URI (`?y=`), before clamping: the number when the param
 *  parses, else `null` (absent → "the default year"). */
export function requestedYear(params: URLSearchParams): number | null {
  const raw = params.get("y");
  return raw != null && Number.isFinite(Number(raw)) ? Number(raw) : null;
}

/**
 * The held year: the requested `?y=` clamped to the reachable year set — the year
 * itself when present, else the nearest reachable one, and the LATEST when the param is
 * absent (`clampYear`). `years` is the union of the reachable buildings' dataset years
 * (`selectableYears`), so every projection resolves against the same set the map's
 * slider offers.
 */
export function resolveYear(
  params: URLSearchParams,
  years: readonly number[],
): number | null {
  return clampYear([...years], requestedYear(params));
}

/**
 * The full coordinate for a set of params. `years` is the reachable year set the time
 * cut clamps to; omit it (or pass an empty set) where the cube isn't loaded — the year
 * then resolves to `null`, exactly as a slider with no reachable year does.
 */
export function resolveCoordinate(
  params: URLSearchParams,
  years: readonly number[] = [],
): CubeCoordinate {
  const rows = resolveRows(params);
  return {
    metric: resolveMetric(params),
    year: resolveYear(params, years),
    rows,
    // The scope is only coherent relative to the row level (`prefixValidAt`), so it is
    // resolved from the already-resolved rows, never independently.
    scope: resolveIn(params, rows),
  };
}

/** Serialize the measure axis to `?m=`, preserving every other param. The metric is
 *  written even at its default — the selector is a standing choice the user made, and
 *  the map/grid links carry it verbatim. */
export function metricToParams(
  metric: SelectableMetricKey,
  prev: URLSearchParams,
): URLSearchParams {
  const sp = new URLSearchParams(prev);
  sp.set("m", metric);
  return sp;
}

/** Serialize the time cut to `?y=` (`null` = follow the default/latest year, omitted
 *  for a clean URI), preserving every other param. */
export function yearToParams(
  year: number | null,
  prev: URLSearchParams,
): URLSearchParams {
  const sp = new URLSearchParams(prev);
  if (year === null) sp.delete("y");
  else sp.set("y", String(year));
  return sp;
}

/** The row-level and scope serializers ride along here so the whole coordinate
 *  vocabulary has ONE import site; the axis module stays their definition. */
export { inToParams, rowsToParams };
