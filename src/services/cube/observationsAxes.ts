/**
 * The Observations finder's single VIEW axis. Observations are the per-building,
 * per-year energy time-series, so this finder IS the energy cube; its four views
 * don't factor into a clean orthogonal grid (three are rows-shaped, one is a map),
 * so it's a flat view selector rather than a Space × Colour cube:
 *
 * - `map`      — geographic energy markers banded at the chosen year (+ a year slider);
 * - `list`     — the per-building observation summary (year count, range, granularity);
 * - `overtime` — the buildings × years efficiency heatmap;
 * - `trend`    — each building's year-over-year direction (improving/flat/worsening).
 *
 * Pure + React-free → Tier-1 testable. Shares `?m=` (metric) and `?y=` (year, read
 * inside `BuildingsMap`) with the energy views; the map viewport (`?c=`/`?z=`) and the
 * list pager (`?offset=`) ride along untouched.
 */
export type ObsView = "map" | "list" | "overtime" | "trend";

/** The default view (omitted from the URL): the geographic energy map. */
export const DEFAULT_VIEW: ObsView = "map";

const VIEWS: ReadonlySet<string> = new Set<ObsView>([
  "map",
  "list",
  "overtime",
  "trend",
]);

/** Read the view from `?view=`; unknown/absent → the default (the geographic map). */
export function resolveView(params: URLSearchParams): ObsView {
  const raw = params.get("view");
  return VIEWS.has(raw ?? "") ? (raw as ObsView) : DEFAULT_VIEW;
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

/** The metric selector shows on every energy view — i.e. all but the plain List. */
export const showsMetric = (view: ObsView): boolean => view !== "list";

/** The year slider shows only on the map (the heatmap + trend span every year at
 *  once). The slider itself lives inside `BuildingsMap`; this just documents the rule. */
export const showsYearSlider = (view: ObsView): boolean => view === "map";
