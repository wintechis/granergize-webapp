/**
 * The Observations finder's single VIEW axis. Observations are the per-building,
 * per-year energy time-series, so this finder IS the energy cube; its views don't
 * factor into a clean orthogonal grid (some are rows-shaped, one is a map), so it's a
 * flat view selector rather than a Space × Colour cube:
 *
 * - `map`       — geographic energy markers banded at the chosen year (+ a year slider);
 * - `list`      — the per-building observation summary (year count, range, granularity);
 * - `overtime`  — the buildings × years efficiency heatmap, with a trailing trend
 *                 column (year-over-year direction — the folded-in Trend view);
 * - `overyears` — the metric's raw figures over the years, one line per building
 *                 (fact-first: time on the x-axis, the building a series).
 * - `pivot`     — the same rows × years grid with the ROW LEVEL chosen (`?rows=`):
 *                 buildings, or their Gemeinde / Kreis / Land / Bund roll-up (Ø over
 *                 the region's buildings), optionally scoped by a drill-down to one
 *                 region (`?in=`, an AGS prefix). See `cube/pivot.ts`.
 *
 * Pure + React-free → Tier-1 testable. Shares `?m=` (metric) and `?y=` (year, read
 * inside `BuildingsMap`) with the energy views; the map viewport (`?c=`/`?z=`) and the
 * list pager (`?offset=`) ride along untouched.
 */
import { type PivotRowLevel, prefixValidAt } from "./pivot.ts";

export type ObsView = "map" | "list" | "overtime" | "overyears" | "pivot";

/** The default view (omitted from the URL): the geographic energy map. */
export const DEFAULT_VIEW: ObsView = "map";

const VIEWS: ReadonlySet<string> = new Set<ObsView>([
  "map",
  "list",
  "overtime",
  "overyears",
  "pivot",
]);

/**
 * Read the view from `?view=`; when absent, fall back to `fallback` (the
 * session-remembered view) if it is a known view, else the default (the geographic
 * map). An unknown URL value is ignored either way.
 */
export function resolveView(
  params: URLSearchParams,
  fallback?: string | null,
): ObsView {
  const raw = params.get("view");
  if (VIEWS.has(raw ?? "")) return raw as ObsView;
  if (fallback && VIEWS.has(fallback)) return fallback as ObsView;
  return DEFAULT_VIEW;
}

/** Serialize the view to `?view=`, omitting the default (clean links) and preserving
 *  the energy params (`?m=`, `?y=`), the map viewport (`?c=`, `?z=`) and the list
 *  pager (`?offset=`). */
export function viewToParams(
  view: ObsView,
  prev: URLSearchParams,
): URLSearchParams {
  const sp = new URLSearchParams(prev);
  if (view === DEFAULT_VIEW) sp.delete("view");
  else sp.set("view", view);
  return sp;
}

/** The pivot's default row level (omitted from the URI): one row per building — the
 *  cube's finest feature grain, i.e. no roll-up. */
export const DEFAULT_ROWS: PivotRowLevel = "building";

const ROW_LEVELS: ReadonlySet<string> = new Set<PivotRowLevel>([
  "building",
  "gemeinde",
  "kreis",
  "land",
  "bund",
]);

/** Read the pivot's row level from `?rows=`; an absent or unknown value falls back to
 *  the default (buildings), so a stale link can't select a level that doesn't exist. */
export function resolveRows(params: URLSearchParams): PivotRowLevel {
  const raw = params.get("rows");
  return ROW_LEVELS.has(raw ?? "") ? raw as PivotRowLevel : DEFAULT_ROWS;
}

/** Serialize the row level to `?rows=`, omitting the default and preserving the other
 *  axes (`?view=`, `?m=`, the viewport, the pager). */
export function rowsToParams(
  rows: PivotRowLevel,
  prev: URLSearchParams,
): URLSearchParams {
  const sp = new URLSearchParams(prev);
  if (rows === DEFAULT_ROWS) sp.delete("rows");
  else sp.set("rows", rows);
  return sp;
}

/** An AGS prefix at one of the ladder's region lengths (Land / Kreis / Gemeinde). */
const AGS_PREFIX = /^\d{2}(\d{3}(\d{3})?)?$/;

/**
 * Read the pivot's region scope from `?in=` — the AGS prefix a drill-down confined the
 * grid to. Rejected (→ `null`, i.e. unscoped) when it isn't an AGS prefix or isn't
 * coherent with the row level (`prefixValidAt`: the scope must be coarser than the
 * rows, else a region row would be mislabelled — fed by only a sub-region's members).
 */
export function resolveIn(
  params: URLSearchParams,
  rows: PivotRowLevel,
): string | null {
  const raw = params.get("in");
  return raw && AGS_PREFIX.test(raw) && prefixValidAt(raw, rows) ? raw : null;
}

/** Serialize the region scope to `?in=` (`null` = unscoped, omitted for a clean URI),
 *  preserving the other axes. */
export function inToParams(
  scope: string | null,
  prev: URLSearchParams,
): URLSearchParams {
  const sp = new URLSearchParams(prev);
  if (scope === null) sp.delete("in");
  else sp.set("in", scope);
  return sp;
}

/** The metric selector shows on every energy view — i.e. all but the plain List. */
export const showsMetric = (view: ObsView): boolean => view !== "list";

/** The year slider shows only on the map (the heatmap + over-years span every year at
 *  once). The slider itself lives inside `BuildingsMap`; this just documents the rule. */
export const showsYearSlider = (view: ObsView): boolean => view === "map";
