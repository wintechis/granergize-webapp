/**
 * The Explore data-cube's THREE orthogonal control axes (replacing the conflated
 * `?view=`/`?explore=` toggle + the map-only colour "lens"). The Buildings finder
 * is a cube over **Space** (building) × **Time** (year) × **Measure** (metric);
 * each view is a choice on three independent axes:
 *
 * - **Space** — `map` (geographic markers) | `rows` (ordered rows).
 * - **Time** — `one` (slice to a year) | `over` (year as an axis) | `compare` (faceted).
 * - **Colour** — what the mark encodes: `ownership` (identity tier, no measure) |
 *   `value` (the measure's band) | `trend` (the measure's change across years).
 *
 * Pure + React-free so the coercion rules are Tier-1 testable. The UI
 * (`CubeAxisBar` + `BuildingsFinder`) reads/writes these through `resolveAxes` /
 * `nextAxes` / `toParams`; `pickRenderer` maps a resolved triple to the renderer.
 */
export type Space = "map" | "rows";
export type Time = "one" | "over" | "compare";
export type Colour = "ownership" | "value" | "trend";

export interface CubeAxes {
  readonly space: Space;
  readonly time: Time;
  readonly colour: Colour;
}

/** The default view (omitted from the URL): the geographic ownership map. */
export const DEFAULT_AXES: CubeAxes = {
  space: "map",
  time: "one",
  colour: "ownership",
};

/** Which surface renders for a resolved triple (`disabled` = not shipped in v1). */
export type CubeRenderer = "map" | "list" | "matrix" | "compare" | "disabled";

const SPACES: ReadonlySet<string> = new Set<Space>(["map", "rows"]);
const TIMES: ReadonlySet<string> = new Set<Time>(["one", "over", "compare"]);
const COLOURS: ReadonlySet<string> = new Set<Colour>([
  "ownership",
  "value",
  "trend",
]);

/**
 * The hard cube constraints, applied to ANY axes triple (read from the URL or
 * produced by a user change) so the resolved state is always coherent:
 * - a Leaflet map is one time cross-section → `space=map ⇒ time=one`;
 * - `trend` needs ≥2 comparable years, else it falls back (to `value` on rows,
 *   `ownership` on the map).
 * `yearCount` is the number of selectable years (0 when energy hasn't loaded).
 */
function clampAxes(axes: CubeAxes, yearCount: number): CubeAxes {
  const { space } = axes;
  let { time, colour } = axes;
  if (space === "map") time = "one";
  if (colour === "trend" && yearCount < 2) {
    colour = space === "map" ? "ownership" : "value";
  }
  return { space, time, colour };
}

/**
 * Read the three axes from the URL, applying back-compat for the retired
 * `?view=`/`?explore=` params (the colour "lens" was never URL-encoded) and the
 * cube constraints. Never trusts the URL: unknown values fall back to defaults.
 */
export function resolveAxes(
  params: URLSearchParams,
  yearCount = 0,
): CubeAxes {
  const rawSpace = params.get("space");
  const rawTime = params.get("time");
  const rawColour = params.get("colour");
  const view = params.get("view"); // legacy: list | (map)
  const explore = params.get("explore"); // legacy: matrix | compare | (map)

  const space: Space = SPACES.has(rawSpace ?? "")
    ? (rawSpace as Space)
    // Legacy: the List guise AND the matrix/compare sub-views are all `rows` now.
    : view === "list" || explore === "matrix" || explore === "compare"
    ? "rows"
    : "map";

  const time: Time = TIMES.has(rawTime ?? "")
    ? (rawTime as Time)
    : explore === "matrix"
    ? "over"
    : explore === "compare"
    ? "compare"
    : "one";

  const colour: Colour = COLOURS.has(rawColour ?? "")
    ? (rawColour as Colour)
    : explore === "matrix" || explore === "compare"
    ? "value"
    : "ownership";

  return clampAxes({ space, time, colour }, yearCount);
}

/**
 * Apply a user's single-axis change, honouring their intent and coercing the
 * OTHER axes to a coherent, shipped combination:
 * - choosing a multi-year **time** (`over`/`compare`) implies abstract `rows` +
 *   a measure (`value` if currently `ownership`) — those layouts are row grids;
 * - choosing **space=map** forces `time=one`;
 * - choosing a measure **colour** while on `rows`+`one` (a non-shipped single
 *   column) lands on the over-time grid (`time=over`).
 * Then the hard {@link clampAxes} constraints finish the job.
 */
export function nextAxes(
  prev: CubeAxes,
  change: Partial<CubeAxes>,
  yearCount: number,
): CubeAxes {
  let { space, time, colour } = { ...prev, ...change };

  if ("time" in change && time !== "one") {
    space = "rows";
    if (colour === "ownership") colour = "value";
  }
  if ("space" in change && space === "map") time = "one";
  if (
    "colour" in change && (colour === "value" || colour === "trend") &&
    space === "rows" && time === "one"
  ) {
    time = "over";
  }
  return clampAxes({ space, time, colour }, yearCount);
}

/** Serialize axes back to URL params (omitting defaults to keep links clean),
 *  starting from `prev` so unrelated params (`?m=`, `?y=`, `?c=`, `?z=`) survive;
 *  the retired `?view=`/`?explore=` are always cleared. */
export function toParams(axes: CubeAxes, prev: URLSearchParams): URLSearchParams {
  const sp = new URLSearchParams(prev);
  sp.delete("view");
  sp.delete("explore");
  const set = (k: string, v: string, def: string) =>
    v === def ? sp.delete(k) : sp.set(k, v);
  set("space", axes.space, DEFAULT_AXES.space);
  set("time", axes.time, DEFAULT_AXES.time);
  set("colour", axes.colour, DEFAULT_AXES.colour);
  return sp;
}

/** The renderer a resolved triple selects (`disabled` for non-shipped combos). */
export function pickRenderer(axes: CubeAxes): CubeRenderer {
  const { space, time, colour } = axes;
  if (space === "map") return "map";
  // space === "rows":
  if (colour === "ownership") return "list"; // the actionable identity list
  if (colour === "value") {
    if (time === "over") return "matrix";
    if (time === "compare") return "compare";
    return "disabled"; // rows + value + one — a single-year ranked grid, v2
  }
  return "disabled"; // rows + trend — a trend grid, v2
}

/** Per-axis option availability for the toggle UI (greys non-shippable picks):
 *  `time` is irrelevant under `space=map` (forced to one) and under
 *  `colour=ownership` (the List collapses time); `trend` needs ≥2 years. */
export function axisOptions(
  axes: CubeAxes,
  yearCount: number,
): {
  time: Record<Time, boolean>;
  colour: Record<Colour, boolean>;
  timeDisabled: boolean;
} {
  const onMap = axes.space === "map";
  const timeDisabled = onMap || axes.colour === "ownership";
  return {
    // On the map, only `one` is meaningful; on rows every layout is available.
    time: { one: true, over: !onMap, compare: !onMap },
    colour: { ownership: true, value: true, trend: yearCount >= 2 },
    timeDisabled,
  };
}
