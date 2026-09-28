/**
 * The Observations finder's single VIEW axis. Observations are the per-building,
 * per-year energy time-series, so this finder IS the energy cube; its views don't
 * factor into a clean orthogonal grid (some are rows-shaped, one is a map), so it's a
 * flat view selector rather than a Space × Colour cube:
 *
 * - `list`      — the per-building observation summary (year count, range, granularity)
 *                 — the DEFAULT, since a finder's first job is to enumerate what you have;
 * - `map`       — geographic energy markers banded at the chosen year (+ a year slider);
 * - `overtime`  — the buildings × years efficiency heatmap, with a trailing trend
 *                 column (year-over-year direction — the folded-in Trend view);
 * - `overyears` — the metric's raw figures over the years, one line per building
 *                 (fact-first: time on the x-axis, the building a series).
 * - `pivot`     — the same rows × years grid with the ROW LEVEL chosen (`?rows=`):
 *                 buildings, or their Gemeinde / Kreis / Land / Bund roll-up (Ø over
 *                 the region's buildings), optionally scoped by a drill-down to one
 *                 region (`?in=`, an AGS prefix). See `cube/pivot.ts`.
 * - `aggregations` — the **saved views** projection: the folded former Aggregations
 *                 finder (own definitions / received snapshots / open regional
 *                 datasets), keeping its own sub-axis `?guise=list|map|timeline`
 *                 (the region choropleth is the regional projection of this cube).
 *                 Step 2 of `plans/plan-cube-centered-ui.md`.
 *
 * Pure + React-free → Tier-1 testable. Shares `?m=` (metric) and `?y=` (year, read
 * inside `BuildingsMap`) with the energy views; the map viewport (`?c=`/`?z=`) and the
 * list pager (`?offset=`) ride along untouched.
 *
 * Besides the view and the pivot's row level/scope this module also owns `?series=` —
 * the **time drill** down to the cube's finest grain (a building's sub-hourly series,
 * rendered as a panel below the over-time / pivot grid). See {@link resolveSeries}.
 */
import { type PivotRowLevel, prefixValidAt } from "./pivot.ts";

export type ObsView =
  | "map"
  | "list"
  | "overtime"
  | "overyears"
  | "pivot"
  | "aggregations";

/** The default view (omitted from the URL): the per-building list. A bare
 *  `/observations` therefore means the List, and choosing the Map writes `?view=map`. */
export const DEFAULT_VIEW: ObsView = "list";

const VIEWS: ReadonlySet<string> = new Set<ObsView>([
  "list",
  "map",
  "overtime",
  "overyears",
  "pivot",
  "aggregations",
]);

/**
 * Read the view from `?view=`; when absent, fall back to `fallback` (the
 * session-remembered view) if it is a known view, else the default (the List). An
 * unknown URL value is ignored either way.
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

/**
 * Read the **series drill** from `?series=` — the building whose sub-hourly (`PT15M`)
 * panel is open below the grid. The value is a building *ref* in the same form the
 * detail routes' `?ref=`/`?uri=` carry (`Building.id`: storage-relative for an own
 * building, an absolute IRI for a shared one), so a building maps to one stable param
 * value. Absent/empty → `null` (no drill).
 *
 * Unlike the view axis and the tier facet this is **not** session-remembered
 * (`facetMemory`): a drill is a transient descent to the finest time grain, not a
 * standing facet — re-entering Explore through its nav tab must not silently re-open
 * somebody's last panel (and re-trigger its fetch). It is URL-only, so it stays
 * shareable and Back-able; the panel's open state derives from the URI alone.
 *
 * Validity is NOT decided here: whether the ref names a building in the current set —
 * and whether that building carries series datasets at all — is a question about data,
 * not about the URI, so the finder resolves it against its buildings (an unresolvable
 * ref simply renders no panel).
 */
export function resolveSeries(params: URLSearchParams): string | null {
  return params.get("series") || null;
}

/** Serialize the series drill to `?series=` (`null` = closed, omitted for a clean
 *  URI), preserving the other axes — the view, the coordinate, the pager. */
export function seriesToParams(
  ref: string | null,
  prev: URLSearchParams,
): URLSearchParams {
  const sp = new URLSearchParams(prev);
  if (!ref) sp.delete("series");
  else sp.set("series", ref);
  return sp;
}

/**
 * The series drill is offered on the two **grid** projections — the over-time matrix
 * and the pivot — whose building rows are exactly the cells the descent starts from.
 * The map/list/over-years/saved-views projections render no building row to drill, so
 * a `?series=` riding along on them is simply inert (it survives a view switch and the
 * panel reappears on return, like `?rows=`/`?in=` do off the pivot).
 */
export const showsSeriesDrill = (view: ObsView): boolean =>
  view === "overtime" || view === "pivot";

/**
 * The metric selector shows on every energy view — i.e. all but the plain List and the
 * saved-views (aggregations) projection, which lenses on its own recorded metrics
 * (each saved view carries the metrics it was defined over) rather than the cube's
 * `?m=` measure axis.
 */
export const showsMetric = (view: ObsView): boolean =>
  view !== "list" && view !== "aggregations";

/** The year slider shows only on the map (the heatmap + over-years span every year at
 *  once). The slider itself lives inside `BuildingsMap`; this just documents the rule. */
export const showsYearSlider = (view: ObsView): boolean => view === "map";
