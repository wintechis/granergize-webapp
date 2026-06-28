/**
 * `GetBuilding` — a single-entity read (`plan-intent-core.md` §8): resolve a building
 * IRI to its typed instance (master data incl. `attributedTo` / estimate flag — the
 * "who produced this, measured or estimated?" question). Reads the warm cache first
 * (`cachedBuilding` — the `["buildingSource", …]` entry the map filled); on a miss it
 * reuses the EntityQuery by-IRI resolver (`entityQuery.resolve`), sharing the app's
 * single-resource fetch + parser rather than re-loading the collection.
 */
import type { PodGateway } from "../../../services/pod/podGateway.ts";
import type { Building } from "../../../types.ts";
import { resolve } from "../../entityQuery.ts";
import { cachedBuilding } from "../../../services/building/buildingSource.ts";

export interface GetBuildingParams {
  /** The building's subject or document IRI. */
  id: string;
}

export async function getBuildingCore(
  gateway: PodGateway,
  params: GetBuildingParams,
): Promise<Building | undefined> {
  const warm = cachedBuilding(params.id);
  if (warm) return warm;
  const obj = await resolve("building", params.id, gateway);
  // resolve() returns the building shape for entity "building"; null/aggregation
  // shapes can't occur here, but guard the type defensively.
  return obj && "energyDatasets" in obj ? (obj as Building) : undefined;
}
