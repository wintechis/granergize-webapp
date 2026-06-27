/**
 * URI encoding for the observation page's **Weather** sub-state (`ui-state.md`): the
 * selected weather parameter (`?wp`) and station (`?ws`). Pure read/serialize, like
 * the cube axis resolvers (`cube/observationsAxes.ts`), so it's Tier-1 testable and
 * the component stays a thin view. Defaults are omitted from the URI for clean links;
 * an absent station means "the nearest" (auto-seeded from the fetched list).
 */
import { WEATHER_PARAMETERS } from "./linkedWeather.ts";

/** The selectable weather parameters (the Select's option set). */
export const WEATHER_PARAM_VALUES: ReadonlySet<string> = new Set<string>([
  WEATHER_PARAMETERS.SUNSHINE_DURATION_ANNUAL,
  WEATHER_PARAMETERS.TEMPERATURE_MEAN_ANNUAL,
  WEATHER_PARAMETERS.PRECIPITATION_ANNUAL,
]);

/** The default parameter (mean temperature), omitted from the URI. */
export const DEFAULT_WEATHER_PARAM = WEATHER_PARAMETERS.TEMPERATURE_MEAN_ANNUAL;

/** Read `?wp`; unknown/absent → the default (mean temperature). */
export function resolveWeatherParameter(params: URLSearchParams): string {
  const raw = params.get("wp");
  return raw && WEATHER_PARAM_VALUES.has(raw) ? raw : DEFAULT_WEATHER_PARAM;
}

/** Read `?ws`; absent → null (the component falls back to the nearest station). */
export function resolveWeatherStation(params: URLSearchParams): string | null {
  return params.get("ws");
}

/**
 * Set `?wp`, omitting the default. Changing the parameter **clears `?ws`** — a
 * station valid for one parameter may not report another, so the nearest re-seeds
 * for the new parameter's list. Preserves all unrelated params.
 */
export function weatherParameterToParams(
  parameter: string,
  prev: URLSearchParams,
): URLSearchParams {
  const sp = new URLSearchParams(prev);
  if (parameter === DEFAULT_WEATHER_PARAM) sp.delete("wp");
  else sp.set("wp", parameter);
  sp.delete("ws");
  return sp;
}

/** Set `?ws` (or clear it for the nearest), preserving all unrelated params. */
export function weatherStationToParams(
  station: string | null,
  prev: URLSearchParams,
): URLSearchParams {
  const sp = new URLSearchParams(prev);
  if (station) sp.set("ws", station);
  else sp.delete("ws");
  return sp;
}
