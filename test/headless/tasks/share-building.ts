/// <reference lib="deno.ns" />
/**
 * Catalog task `share-building` (headless): A shares a building with B by ROLE.
 * Exercises role→recipient resolution, the grant + inbox archival flow, AND the
 * WAC enforcement truth (B can actually fetch the building, not just see the log).
 */
import { restore, snapshot, type TaskContext } from "../taskContext.ts";
import {
  createRoom,
  deleteRoom,
  enterRoom,
  getMembersByRole,
  setMyRole,
} from "../../../src/services/interop/dataRoom.ts";
import { shareBuildingData } from "../../../src/services/interop/share.ts";
import { drainInbox } from "../../../src/services/interop/inbox.ts";
import { getSharedWithMe } from "../../../src/services/interop/sharingManager.ts";
import {
  deleteBuilding,
  newBuildingUri,
  serializeBuildingToTurtle,
  uploadBuilding,
} from "../../../src/services/rdf/building/buildingSerializer.ts";
import { podResources } from "../../../src/services/pod/solidUtils.ts";

import {
  buildingFileUrl,
} from "../../../src/services/rdf/building/buildingId.ts";

export const name = "share-building";

export async function run(ctx: TaskContext): Promise<void> {
  const { a, b, check } = ctx;
  const id = `sb-${Date.now()}`;
  const uri = newBuildingUri(a.webId, id);
  const bSharedIn = podResources(b.webId).sharedIn;
  const bSharedInSnap = await snapshot(b.raw, bSharedIn);

  let room = "";
  try {
    // A creates an Investor building (discovered by listing buildings/).
    const ttl = serializeBuildingToTurtle(
      { streetAddress: "Teststraße 1", locality: "Nürnberg", lat: "49.45", long: "11.08" },
      uri,
      undefined,
      { agent: a.webId },
    );
    await uploadBuilding(a.session, uri, ttl, a.webId);

    // A hosts a room, B joins + takes the Investor role.
    room = await createRoom(a.session);
    await enterRoom(room, b.session);
    await setMyRole(room, ["investor"], b.session);

    const recipients = await getMembersByRole(room, "investor", a.session);
    check("Investor role resolves to B", recipients.includes(b.webId), `[${recipients.join(", ")}]`);

    for (const wid of recipients) {
      await shareBuildingData(uri, wid, a.session, { includeEnergyData: false });
    }
    await drainInbox(b.session); // archive the grant into B's shared-in/

    const shared = await getSharedWithMe(b.session);
    const fileUri = buildingFileUrl(uri);
    check(
      "B sees the shared building under 'shared with you'",
      shared.some((s) => buildingFileUrl(s.buildingUri) === fileUri),
      `shared=[${shared.map((s) => s.buildingUri).join(", ")}]`,
    );

    const bRead = await b.raw.fetch(`${uri}?t=${Date.now()}`);
    check("B can actually READ the building (ACL enforcement)", bRead.ok, `HTTP ${bRead.status}`);
  } finally {
    await deleteBuilding(a.session, a.webId, uri).catch(() => {});
    if (room) await deleteRoom(room, a.session).catch(() => {});
    await restore(b.raw, bSharedIn, bSharedInSnap);
  }
}
