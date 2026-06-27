import { type Building } from "../../types.ts";
import { type RegionGrain } from "../../services/sources/regionGeometry.ts";

/** AGS prefix length per grain — Land = 2, Kreis = 5, Gemeinde = 8 digits. */
const AGS_LEN: Record<RegionGrain, number> = { land: 2, kreis: 5, gemeinde: 8 };

export interface RegionGrouping {
  /** Region AGS (sliced to the grain) → the buildings that fall in it. */
  byAgs: Map<string, Building[]>;
  /** Buildings with no usable `regionAgs` — can't be placed on the choropleth. */
  unplaced: number;
}

/**
 * Group buildings by the region they sit in, at the given grain, from each building's
 * **stored** `regionAgs` (the 8-digit Gemeinde AGS resolved at geocode time) sliced to the
 * grain's prefix (Land = 2, Kreis = 5). No network — purely the cached field. Buildings
 * without a usable AGS are counted as `unplaced` (surfaced, never silently dropped). Pure.
 */
export function buildingsByRegion(
  buildings: readonly Building[],
  grain: RegionGrain,
): RegionGrouping {
  const len = AGS_LEN[grain];
  const byAgs = new Map<string, Building[]>();
  let unplaced = 0;
  for (const b of buildings) {
    const full = b.regionAgs;
    if (!full || full.length < len) {
      unplaced++;
      continue;
    }
    const ags = full.slice(0, len);
    const list = byAgs.get(ags);
    if (list) list.push(b);
    else byAgs.set(ags, [b]);
  }
  return { byAgs, unplaced };
}
