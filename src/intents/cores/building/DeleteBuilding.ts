// Intent core (React-free) for DeleteBuilding. See ./README.md for the
// core/adapter split.
import type { PodGateway } from "../../../services/pod/podGateway.ts";
import { deleteBuildingResource } from "../../../services/buildingActions.ts";
import type { Building } from "../../../types.ts";

/** Parameters of the DeleteBuilding intent. */
export interface DeleteBuildingParams {
  /** The building to permanently delete (caller confirms first). */
  building: Building;
}

/**
 * A DeleteBuilding outcome carrying the deleted building's IRI — exactly what the
 * adapter's `onSuccess` rapid-delete cache patch needs to drop the row from the
 * list cache (the `setQueriesData` filter on `b.uri !== building.uri`).
 */
export interface DeleteBuildingOutcome {
  /** The deleted building's file IRI (`building.uri`). */
  uri: string;
}

/**
 * React-free core of {@link import("../hooks/mutations.ts").useDeleteBuilding}:
 * permanently delete an owned building (revoke recipients, then delete the file
 * after a server-confirmed read-after-write). Returns the deleted `uri` so the
 * adapter can authoritatively patch it out of the list cache; the
 * `setQueriesData` rapid-delete patch + the `onSettled` invalidations stay in
 * the adapter.
 */
export async function deleteBuildingCore(
  gateway: PodGateway,
  params: DeleteBuildingParams,
): Promise<DeleteBuildingOutcome> {
  await deleteBuildingResource(gateway, params.building);
  return { uri: params.building.uri };
}
