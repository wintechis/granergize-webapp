/**
 * `GetBuilding` — a single-entity read (`plan-intent-core.md` §8): resolve a building
 * IRI to its typed instance (master data incl. `attributedTo` / estimate flag — the
 * "who produced this, measured or estimated?" question). Reuses the EntityQuery
 * by-IRI resolver (`entityQuery.resolve`), so it shares the app's single-resource
 * fetch + parser rather than re-loading the collection.
 */
import type { PodGateway } from "../../../services/pod/podGateway.ts";
import type { BuildingType } from "../../../types.ts";
import { resolve } from "../../entityQuery.ts";

export interface GetBuildingParams {
  /** The building's subject or document IRI. */
  id: string;
}

export async function getBuildingCore(
  gateway: PodGateway,
  params: GetBuildingParams,
): Promise<BuildingType | undefined> {
  const obj = await resolve("building", params.id, gateway);
  // resolve() returns the building shape for entity "building"; null/aggregation
  // shapes can't occur here, but guard the type defensively.
  return obj && "energyDatasets" in obj ? (obj as BuildingType) : undefined;
}
