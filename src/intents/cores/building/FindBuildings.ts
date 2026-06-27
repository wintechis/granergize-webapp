/**
 * `FindBuildings` — the first **query** read core (`plan-intent-core.md` §8): load
 * the visible building set, then narrow it with the attribute {@link Selector}
 * (`plan-attribute-facets.md`). A pure read — no writes — returning the matching
 * `BuildingType[]`.
 *
 * Loads over the existing headless loader (`fetchAndParseData`) for now; it
 * re-points to the IRI-keyed resource store when that lands ([[project_ldp_query_layer]])
 * without changing this signature. The loader is injectable so the filtering is
 * Tier-1-testable without a Pod (the selector itself is the tested unit).
 */
import type { PodGateway } from "../../../services/pod/podGateway.ts";
import type { BuildingType } from "../../../types.ts";
import { fetchAndParseData } from "../../../services/TurtleParsing.ts";
import { filter, type Selector } from "../../selector.ts";

/** Load the viewer's visible buildings (own ∪ shared-not-hidden) headlessly. */
export type LoadVisibleBuildings = (gateway: PodGateway) => Promise<BuildingType[]>;

const defaultLoad: LoadVisibleBuildings = async (gateway) =>
  (await fetchAndParseData(gateway)).buildings;

/** Params for FindBuildings — an optional selector (absent ⇒ the whole set). */
export interface FindBuildingsParams {
  selector?: Selector;
}

export async function findBuildingsCore(
  gateway: PodGateway,
  params: FindBuildingsParams,
  load: LoadVisibleBuildings = defaultLoad,
): Promise<BuildingType[]> {
  const buildings = await load(gateway);
  return params.selector ? filter(buildings, params.selector) : buildings;
}
