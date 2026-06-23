/**
 * URI encoding for the observation page's user-energy (Lastgang) chart sub-state
 * (`ui-state.md`): the active view tab (`?tab`), the selected day (`?day`) and month
 * (`?month`). Pure read/serialize like the cube axis resolvers
 * (`cube/observationsAxes.ts`), so it's Tier-1 testable and the chart stays a thin
 * view. The default tab is omitted from the URI; an absent day/month means "auto-seed"
 * (the first day / latest month from the listing), resolved in the component.
 */

/** The chart's view tabs, in render order — the index here IS the MUI Tabs index. */
export const SERIES_TABS = ["day", "totals", "profile", "calendar"] as const;
export type SeriesTab = typeof SERIES_TABS[number];
export const DEFAULT_SERIES_TAB: SeriesTab = "day";

/** Read `?tab`; unknown/absent → the default ("day"). */
export function resolveSeriesTab(params: URLSearchParams): SeriesTab {
  const raw = params.get("tab");
  return (SERIES_TABS as readonly string[]).includes(raw ?? "")
    ? (raw as SeriesTab)
    : DEFAULT_SERIES_TAB;
}

/** The MUI Tabs index (0–3) for the URI's tab. */
export function resolveSeriesTabIndex(params: URLSearchParams): number {
  return SERIES_TABS.indexOf(resolveSeriesTab(params));
}

/** Serialize a tab index (0–3) to `?tab`, omitting the default; preserves the rest. */
export function seriesTabToParams(
  index: number,
  prev: URLSearchParams,
): URLSearchParams {
  const sp = new URLSearchParams(prev);
  const tab = SERIES_TABS[index] ?? DEFAULT_SERIES_TAB;
  if (tab === DEFAULT_SERIES_TAB) sp.delete("tab");
  else sp.set("tab", tab);
  return sp;
}

/** Read `?day` (YYYY-MM-DD); absent → null (the component auto-seeds the first day). */
export function resolveSeriesDay(params: URLSearchParams): string | null {
  return params.get("day");
}

/** Set/clear `?day`, preserving all unrelated params. */
export function seriesDayToParams(
  day: string | null,
  prev: URLSearchParams,
): URLSearchParams {
  const sp = new URLSearchParams(prev);
  if (day) sp.set("day", day);
  else sp.delete("day");
  return sp;
}

/** Read `?month` (YYYY-MM); absent → null (the component auto-seeds the latest). */
export function resolveSeriesMonth(params: URLSearchParams): string | null {
  return params.get("month");
}

/** Set/clear `?month`, preserving all unrelated params. */
export function seriesMonthToParams(
  month: string | null,
  prev: URLSearchParams,
): URLSearchParams {
  const sp = new URLSearchParams(prev);
  if (month) sp.set("month", month);
  else sp.delete("month");
  return sp;
}
