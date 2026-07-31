import type { Building } from "../../types.ts";
import type { MapCentre } from "../sources/openBuildings.ts";
import type { EnergyMetricKey } from "../energy/energyDataset.ts";
import { FINDERS } from "../../routes.ts";
import { DEFAULT_ROWS, inToParams, resolveIn } from "./observationsAxes.ts";

/**
 * **"Explore this"** — the coordinate an entity page hands to the Explore surface
 * (Step 4 of `plans/plan-cube-centered-ui.md`). An entity page is a drill *endpoint*
 * ("this cell's neighborhood"); these builders are the way back OUT into the cube, at
 * the coordinate the entity sits at, so the user lands beside the entity's peers
 * instead of on a bare Explore.
 *
 * Nothing new is encoded: every target is composed from the axes `notes/ui-state.md`
 * already defines (`view`, `rows`, `in`, `m`, the map viewport `c`/`z`), and a scope is
 * emitted only if `resolveIn` — the very resolver Explore reads it back with — accepts
 * it, so a built link can never carry a coordinate the surface would silently drop.
 * Pure + React-free → unit-tested like the axis modules it composes.
 *
 * Two conventions are deliberately broken from, both for the same reason — the view
 * axis is *session-remembered* (`facetMemory`), so absence means "whatever you last
 * picked", not "the default":
 * - `view=map` is written OUT even though `map` is the default view; an affordance
 *   that promises the map must pin it.
 * - the default row level (`rows=building`) is still OMITTED — it is not remembered,
 *   so absence really is the default there.
 */

/** Zoom the map is seeded at when it is framed on ONE building — close enough to see
 *  the building's own block, matching the locator thumbnail's grain. (The place search
 *  in `ExploreControl` uses 12 for a whole Gemeinde.) */
export const EXPLORE_BUILDING_ZOOM = 16;

/** Where "explore this" goes: the Explore URI, plus — when the target is the map framed
 *  on a coordinate — the viewport to prime. The in-session viewport store
 *  (`lib/mapViewport.ts`) WINS over `?c`/`?z` on the map's re-mount, so a caller that
 *  gets a `viewport` back must prime the store too, or the seed is ignored whenever the
 *  user has already panned Explore's map this session. */
export interface ExploreTarget {
  readonly to: string;
  readonly viewport?: { readonly centre: MapCentre; readonly zoom: number };
}

/** `/explore?<params>` — the one place the Explore surface's path and its query string
 *  are joined. */
const exploreRoute = (params: URLSearchParams): string =>
  `${FINDERS.explore}?${params}`;

/**
 * The building's own cut of the cube: the **pivot** confined to its Gemeinde
 * (`view=pivot&in=<AGS>`, rows left at their `building` default) — the building beside
 * the peers it shares a municipality with. A building with no usable region AGS has no
 * such neighborhood, so it falls back to the **map** framed on its coordinates
 * (`view=map&c=<lat>,<lng>&z=`), and to the plain map when it isn't located either.
 */
export function exploreBuildingTarget(building: Building): ExploreTarget {
  const ags = building.regionAgs?.trim();
  if (ags) {
    const params = inToParams(ags, new URLSearchParams({ view: "pivot" }));
    // Emit the scope only if Explore's own resolver would keep it (a malformed or
    // non-ladder AGS resolves to `null` — an unscoped pivot, which is not what the
    // affordance promises, so prefer the map framing in that case).
    if (resolveIn(params, DEFAULT_ROWS) === ags) return { to: exploreRoute(params) };
  }
  const params = new URLSearchParams({ view: "map" });
  const { lat, long } = building;
  if (lat == null || long == null) return { to: exploreRoute(params) };
  // The viewport format is the map's own (`mapViewportLayers.tsx` writes 5 decimals).
  params.set("c", `${lat.toFixed(5)},${long.toFixed(5)}`);
  params.set("z", String(EXPLORE_BUILDING_ZOOM));
  return {
    to: exploreRoute(params),
    viewport: { centre: { lat, long }, zoom: EXPLORE_BUILDING_ZOOM },
  };
}

/**
 * The observation (energy) page's cut: the **over-time heatmap** (`view=overtime`) —
 * the surface where this building's years sit beside its peers'. The measure rides
 * along when the caller holds one; the observation page pins no `?m=` of its own today,
 * so it omits it and the heatmap opens on the standing metric.
 */
export function exploreOverTimeTarget(metric?: EnergyMetricKey): ExploreTarget {
  const params = new URLSearchParams({ view: "overtime" });
  if (metric) params.set("m", metric);
  return { to: exploreRoute(params) };
}
