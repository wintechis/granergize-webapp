/// <reference lib="deno.ns" />
/**
 * Catalog task `delete-shared-building` (headless): when the owner DELETES a
 * building that's currently shared, the recipient must lose it cleanly. Proves the
 * symmetric-with-views behaviour: `deleteBuildingResource` revokes + notifies every
 * recipient FIRST, so (a) the owner's shared-out/ log records the revocation
 * (no dangling grant for a deleted resource), and (b) the building folds out of the
 * recipient's "shared with you" once they drain their inbox.
 */
import { restore, snapshot, type TaskContext } from "../taskContext.ts";
import { shareBuildingData } from "../../../src/services/interop/share.ts";
import {
  getSharedBuildings,
  getSharedWithMe,
} from "../../../src/services/interop/sharingManager.ts";
import { drainInbox } from "../../../src/services/interop/inbox.ts";
import { deleteBuildingResource } from "../../../src/services/buildingActions.ts";
import {
  newBuildingUri,
  serializeBuildingToTurtle,
  uploadBuilding,
} from "../../../src/services/rdf/building/buildingSerializer.ts";
import { podResources } from "../../../src/services/pod/solidUtils.ts";
import type { BuildingType } from "../../../src/types.ts";

import {
  buildingFileUri,
} from "../../../src/services/rdf/building/buildingId.ts";

export const name = "delete-shared-building";

export async function run(ctx: TaskContext): Promise<void> {
  const { a, b, check } = ctx;
  const id = `dsb-${Date.now()}`;
  const uri = newBuildingUri(a.webId, id);
  const fileUri = buildingFileUri(uri);
  const bSharedIn = podResources(b.webId).sharedIn;
  const bSharedInSnap = await snapshot(b.raw, bSharedIn);

  const bSeesIt = async () =>
    (await getSharedWithMe(b.session)).some((s) =>
      buildingFileUri(s.buildingUri) === fileUri
    );

  try {
    // A creates a building and shares it with B (static data only).
    const ttl = serializeBuildingToTurtle(
      { streetAddress: "Löschweg 1", locality: "Nürnberg", lat: "49.45", long: "11.08" },
      uri,
      undefined,
      { agent: a.webId },
    );
    await uploadBuilding(a.session, uri, ttl, a.webId);
    await shareBuildingData(uri, b.webId, a.session, { includeEnergyData: false });
    await drainInbox(b.session);
    check("baseline: B sees the shared building", await bSeesIt());

    // A deletes the building through the real app path (revokes recipients first).
    await deleteBuildingResource(a.session, { uri } as unknown as BuildingType);

    // Owner side: shared-out/ no longer asserts an active grant (revocation logged).
    const ownerShared = await getSharedBuildings(a.session);
    check(
      "owner's shared-out/ no longer lists the deleted building",
      !ownerShared.some((s) => buildingFileUri(s.buildingUri) === fileUri),
      `shared=[${ownerShared.map((s) => s.buildingUri).join(", ")}]`,
    );

    // Recipient side: after draining the inbox, the building folds out of B's list.
    await drainInbox(b.session);
    check("B no longer sees the building after the owner deletes it", !(await bSeesIt()));

    // And the resource really is gone (404 for B).
    const bRead = await b.raw.fetch(`${fileUri}?t=${Date.now()}`);
    await bRead.body?.cancel().catch(() => {});
    check("B can no longer READ the building", !bRead.ok, `HTTP ${bRead.status}`);
  } finally {
    // The building is already deleted; just restore B's shared-in/ snapshot.
    await restore(b.raw, bSharedIn, bSharedInSnap);
  }
}
