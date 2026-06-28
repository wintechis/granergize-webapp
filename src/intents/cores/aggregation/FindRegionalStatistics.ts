/**
 * `FindRegionalStatistics` — a **query** read (plan-open-tier-intents §"New
 * intents"): the public `linked-regionalstatistik` datasets available for a region
 * (the `open` tier of aggregations). Returns the browseable `OpenRegionalItem[]`
 * catalogue — one (table × Bundesland) leaf — scoped by an explicit region, a
 * building's region, or (default) the user's whole portfolio. A pure "find" (CQS):
 * it lists the datasets; fetching a table's figures (`RegionalObservation[]`) is a
 * separate GET on the detail surface, not this verb.
 */
import type { PodGateway } from "../../../services/pod/podGateway.ts";
import type { Building } from "../../../types.ts";
import { resolve } from "../../entityQuery.ts";
import { fetchAndParseData } from "../../../services/turtleParsing.ts";
import {
  cachedBuilding,
  cachedVisibleBuildings,
} from "../../../services/building/buildingSource.ts";
import { bundeslandToAgs } from "../../../services/sources/region.ts";
import {
  openRegionalItemsFromBuildings,
  type OpenRegionalItem,
} from "../../../services/sources/openRegional.ts";

export interface FindRegionalStatisticsParams {
  /** Restrict to one Bundesland — a name ("Bayern") or its 2-digit AGS ("09"). */
  region?: string;
  /** Derive the region from one building instead (its IRI, resolved). */
  building?: string;
}

/** Load the viewer's visible buildings (own ∪ shared-not-hidden) headlessly. */
export type LoadVisibleBuildings = (gateway: PodGateway) => Promise<Building[]>;
const defaultLoad: LoadVisibleBuildings = async (gateway) =>
  cachedVisibleBuildings(gateway) ?? (await fetchAndParseData(gateway)).buildings;

export async function findRegionalStatisticsCore(
  gateway: PodGateway,
  params: FindRegionalStatisticsParams,
  load: LoadVisibleBuildings = defaultLoad,
): Promise<OpenRegionalItem[]> {
  // Source regions: an explicit Bundesland uses the full 16-Land catalogue (then
  // filters); a building uses its own region; otherwise the whole visible portfolio.
  let buildings: Building[];
  if (params.region) {
    buildings = [];
  } else if (params.building) {
    const obj = cachedBuilding(params.building) ??
      await resolve("building", params.building, gateway);
    buildings = obj ? [obj as Building] : [];
  } else {
    buildings = await load(gateway);
  }

  let items = openRegionalItemsFromBuildings(buildings);
  if (params.region) {
    const ags = bundeslandToAgs(params.region) ?? params.region;
    items = items.filter((it) => it.ags === ags);
  }
  return items;
}
