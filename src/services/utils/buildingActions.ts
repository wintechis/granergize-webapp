import type { Session } from "@inrupt/solid-client-authn-browser";
import type { BuildingType } from "../../../types/types.ts";
import { deleteBuilding } from "./buildingSerializer.ts";
import { formatResourceList, listContainedResources } from "./podDelete.ts";
import { getStorageRoot } from "./solidUtils.ts";

/** The building file URI (fragment stripped) for an owned building. */
function buildingFileUri(building: BuildingType): string {
  return ((building.sourceUri ?? building.uri) as string).split("#")[0];
}

/**
 * Build the human-readable confirmation text for deleting an owned building —
 * enumerating exactly which resources will be removed (the building file + every
 * file in its per-building energy subtree). Pure (no DOM `confirm`, no write), so
 * the caller owns the actual confirmation UI and this stays unit-testable.
 *
 * Resource enumeration and storage-root resolution are best-effort: a listing or
 * root failure still yields a usable message, just with a coarser preview.
 */
export async function buildBuildingDeletionPreview(
  session: Session,
  building: BuildingType,
): Promise<{ fileUri: string; message: string }> {
  const fileUri = buildingFileUri(building);

  let root = "";
  try {
    if (session.info.webId) root = getStorageRoot(session.info.webId);
  } catch { /* storage root not resolved — fall back to absolute URLs */ }

  const resources = [fileUri];
  try {
    resources.push(
      ...await listContainedResources(
        `${fileUri.replace(/\.ttl$/, "")}/`,
        session,
      ),
    );
  } catch { /* preview only */ }

  const label = (building.streetAddress as string) || `Building ${building.id}`;
  const message = `Delete "${label}"?\n\nThis permanently deletes ${resources.length} ` +
    `resource(s) and removes the building's registry entry:\n\n` +
    `${formatResourceList(resources, root)}\n\nThis cannot be undone.`;

  return { fileUri, message };
}

/**
 * Permanently delete an owned building — its file, energy subtree, and registry
 * entry. Pure data operation (no confirmation UI); confirm first at the call site
 * with {@link buildBuildingDeletionPreview}. Throws if the delete fails.
 */
export async function deleteBuildingResource(
  session: Session,
  building: BuildingType,
): Promise<void> {
  await deleteBuilding(session, session.info.webId!, buildingFileUri(building));
}
