/**
 * The Buildings finder's single SPATIAL axis. Buildings is the space/identity view
 * of the building set — the energy cube moved to the Observations finder
 * (`observationsAxes.ts`) — so this is just Map ⇄ List over the owned/shared set:
 *
 * - `map`  — geographic owned/shared markers;
 * - `rows` — the actionable building list (tier dots + share/delete).
 *
 * Pure + React-free → Tier-1 testable. `?space=map|rows`, map being the implicit
 * default (omitted from the URL).
 */
export type Space = "map" | "rows";

export interface CubeAxes {
  readonly space: Space;
}

/** The default view (omitted from the URL): the geographic ownership map. */
export const DEFAULT_AXES: CubeAxes = { space: "map" };

/** Which surface renders for a resolved axis. */
export type CubeRenderer = "map" | "list";

const SPACES: ReadonlySet<string> = new Set<Space>(["map", "rows"]);

/** Read the spatial axis from `?space=`; unknown/absent → the default (the map). */
export function resolveAxes(params: URLSearchParams): CubeAxes {
  const raw = params.get("space");
  return { space: SPACES.has(raw ?? "") ? (raw as Space) : "map" };
}

/** Serialize to `?space=`, omitting the default and preserving unrelated params
 *  (the map's `?c=`/`?z=`, the list's `?offset=`). */
export function toParams(axes: CubeAxes, prev: URLSearchParams): URLSearchParams {
  const sp = new URLSearchParams(prev);
  if (axes.space === DEFAULT_AXES.space) sp.delete("space");
  else sp.set("space", axes.space);
  return sp;
}

/** The renderer a resolved axis selects. */
export function pickRenderer({ space }: CubeAxes): CubeRenderer {
  return space === "map" ? "map" : "list";
}
