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
 *
 * Pure + React-free → Tier-1 testable. Shares `?m=` (metric) and `?y=` (year, read
 * inside `BuildingsMap`) with the energy views; the map viewport (`?c=`/`?z=`) and the
 * list pager (`?offset=`) ride along untouched.
 */
export type ObsView = "list" | "map" | "overtime" | "overyears";

/** The default view (omitted from the URL): the per-building list. A bare
 *  `/observations` therefore means the List, and choosing the Map writes `?view=map`. */
export const DEFAULT_VIEW: ObsView = "list";

const VIEWS: ReadonlySet<string> = new Set<ObsView>([
  "list",
  "map",
  "overtime",
  "overyears",
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

/** The metric selector shows on every energy view — i.e. all but the plain List. Since
 *  the List is the default, a bare `/observations` carries no metric selector (nor year
 *  slider): neither applies until you pick an energy view. */
export const showsMetric = (view: ObsView): boolean => view !== "list";

/** The year slider shows only on the map (the heatmap + over-years span every year at
 *  once). The slider itself lives inside `BuildingsMap`; this just documents the rule. */
export const showsYearSlider = (view: ObsView): boolean => view === "map";
