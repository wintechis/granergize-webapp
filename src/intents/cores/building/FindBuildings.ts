/**
 * `FindBuildings` — the first **query** read core (`plan-intent-core.md` §8): load
 * the visible building set, then narrow it with the attribute {@link Selector}
 * (`plan-attribute-facets.md`). A pure read — no writes — returning the matching
 * `Building[]`.
 *
 * Reads the warm IRI-keyed cache when the app is mounted (`cachedVisibleBuildings` —
 * the same `["buildingSource", …]` entries the map filled), falling back to the headless
 * loader (`fetchAndParseData`) when the cache is cold (headless / before the map ran).
 * The loader is injectable so the filtering is Tier-1-testable without a Pod (the
 * selector itself is the tested unit).
 */
import type { PodGateway } from "../../../services/pod/podGateway.ts";
import type { Building } from "../../../types.ts";
import { fetchAndParseData } from "../../../services/turtleParsing.ts";
import { cachedVisibleBuildings } from "../../../services/building/buildingSource.ts";
import { filter, type Selector } from "../../selector.ts";

/** Load the viewer's visible buildings (own ∪ shared-not-hidden) headlessly. */
export type LoadVisibleBuildings = (gateway: PodGateway) => Promise<Building[]>;

const defaultLoad: LoadVisibleBuildings = async (gateway) =>
  cachedVisibleBuildings(gateway) ?? (await fetchAndParseData(gateway)).buildings;

/** Params for FindBuildings — an optional selector (absent ⇒ the whole set). */
export interface FindBuildingsParams {
  selector?: Selector;
}

export async function findBuildingsCore(
  gateway: PodGateway,
  params: FindBuildingsParams,
  load: LoadVisibleBuildings = defaultLoad,
): Promise<Building[]> {
  const buildings = await load(gateway);
  return params.selector ? filter(buildings, params.selector) : buildings;
}
