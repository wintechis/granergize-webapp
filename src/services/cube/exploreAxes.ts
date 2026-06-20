/**
 * The Buildings finder's TWO orthogonal view axes. The finder is a cube over
 * **Space** (building) × **Time** (year) × **Measure** (energy metric); a view is
 * a choice on just two user-facing axes — **Time falls out of Space** (a map shows
 * one year, a list shows every year), so it isn't a separate control:
 *
 * - **Space** — `map` (geographic Leaflet markers) | `rows` (the list / grid area).
 * - **Colour** — what the mark encodes: `ownership` (owned/shared tier, no measure)
 *   | `energy` (the metric's efficiency/magnitude band).
 *
 * The 2 × 2 is fully orthogonal (every combination is a real view, so there is no
 * cross-axis coercion):
 * - `map` + `ownership` → geographic pins by owner;
 * - `map` + `energy` → pins banded by the metric at one year (+ a year slider);
 * - `rows` + `ownership` → the actionable building list (tier dots + share/delete);
 * - `rows` + `energy` → the efficiency-over-time heatmap (building × year).
 *
 * Pure + React-free so it's Tier-1 testable. (Replaces the old conflated
 * `?view=`/`?explore=` toggle + the map-only ownership/energy/trend "lens"; the
 * trend lens and the compare-years view were dropped.)
 */
export type Space = "map" | "rows";
export type Colour = "ownership" | "energy";

export interface CubeAxes {
  readonly space: Space;
  readonly colour: Colour;
}

/** The default view (omitted from the URL): the geographic ownership map. */
export const DEFAULT_AXES: CubeAxes = { space: "map", colour: "ownership" };

/** Which surface renders for a resolved pair. */
export type CubeRenderer = "map" | "list" | "matrix";

const SPACES: ReadonlySet<string> = new Set<Space>(["map", "rows"]);
const COLOURS: ReadonlySet<string> = new Set<Colour>(["ownership", "energy"]);

/**
 * Read the two axes from the URL, applying back-compat for the retired
 * `?view=`/`?explore=` params (the colour was never URL-encoded). Never trusts the
 * URL: unknown values fall back to defaults. The two axes are independent, so
 * there is no coercion.
 */
export function resolveAxes(params: URLSearchParams): CubeAxes {
  const rawSpace = params.get("space");
  const rawColour = params.get("colour");
  const view = params.get("view"); // legacy: list | (map)
  const explore = params.get("explore"); // legacy: matrix | compare | (map)
  const legacyRows = view === "list" || explore === "matrix" ||
    explore === "compare";

  const space: Space = SPACES.has(rawSpace ?? "")
    ? (rawSpace as Space)
    : legacyRows
    ? "rows"
    : "map";

  const colour: Colour = COLOURS.has(rawColour ?? "")
    ? (rawColour as Colour)
    // The legacy matrix/compare grids both map to the energy heatmap now.
    : explore === "matrix" || explore === "compare"
    ? "energy"
    : "ownership";

  return { space, colour };
}

/** Serialize axes to URL params, omitting defaults (clean links) and clearing the
 *  retired `?view=`/`?explore=`; unrelated params (`?m=`, `?y=`, `?c=`, `?z=`) on
 *  `prev` survive. */
export function toParams(axes: CubeAxes, prev: URLSearchParams): URLSearchParams {
  const sp = new URLSearchParams(prev);
  sp.delete("view");
  sp.delete("explore");
  const set = (k: string, v: string, def: string) =>
    v === def ? sp.delete(k) : sp.set(k, v);
  set("space", axes.space, DEFAULT_AXES.space);
  set("colour", axes.colour, DEFAULT_AXES.colour);
  return sp;
}

/** The renderer a resolved pair selects. */
export function pickRenderer({ space, colour }: CubeAxes): CubeRenderer {
  if (space === "map") return "map";
  return colour === "energy" ? "matrix" : "list";
}

/** The energy metric selector is shown whenever colour encodes the measure. */
export const showsMetric = (axes: CubeAxes): boolean => axes.colour === "energy";

/** The year slider is shown only on the map's energy view (a list shows all years
 *  at once as the heatmap, so it needs no year pick). */
export const showsYearSlider = (axes: CubeAxes): boolean =>
  axes.space === "map" && axes.colour === "energy";
