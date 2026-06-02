import type { Session } from "@inrupt/solid-client-authn-browser";
import type { BuildingType } from "../../../types/types.ts";
import { deleteBuilding } from "./buildingSerializer.ts";
import { formatResourceList, listContainedResources } from "./podDelete.ts";
import { getStorageRoot } from "./solidUtils.ts";

/**
 * Confirm (showing exactly which resources will be removed) and then permanently
 * delete an owned building — its file, energy subtree, and registry entry.
 * Returns `true` if it was deleted, `false` if the user cancelled. Throws if the
 * delete itself fails. Shared by the DATA tab's building list (and anywhere else
 * that needs the same confirm + delete flow).
 */
export async function confirmAndDeleteBuilding(
  session: Session,
  building: BuildingType,
): Promise<boolean> {
  const fileUri = ((building.sourceUri ?? building.uri) as string).split("#")[0];

  let root = "";
  try {
    if (session.info.webId) root = getStorageRoot(session.info.webId);
  } catch { /* storage root not resolved — fall back to absolute URLs */ }

  // Enumerate what will be removed: the building file + every file in its
  // per-building energy subtree. Best-effort — a listing failure still lets the
  // user delete, just without the preview.
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
  if (
    !globalThis.confirm(
      `Delete "${label}"?\n\nThis permanently deletes ${resources.length} ` +
        `resource(s) and removes the building's registry entry:\n\n` +
        `${formatResourceList(resources, root)}\n\nThis cannot be undone.`,
    )
  ) {
    return false;
  }

  await deleteBuilding(session, session.info.webId!, fileUri);
  return true;
}
