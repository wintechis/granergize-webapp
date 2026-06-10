/// <reference lib="deno.ns" />
/**
 * Catalog task `archive-restore` (headless): the dev-mode backup/restore feature
 * against a real CSS. Two things unit tests with a fake Pod can't prove:
 *   1. export → delete → import actually round-trips a resource through the server.
 *   2. `reissueGrants` rebuilds WAC enforcement from the `shared-out/` log — after
 *      the `.acl` is lost, B can READ the building again purely from the log.
 */
import { restore, snapshot, type TaskContext } from "../taskContext.ts";
import {
  exportArchive,
  importArchive,
} from "../../../src/services/pod/podArchive.ts";
import { reissueGrants, shareBuildingData } from "../../../src/services/interop/share.ts";
import { removeFromACL } from "../../../src/services/interop/sharingManager.ts";
import { drainInbox } from "../../../src/services/interop/inbox.ts";
import {
  deleteBuilding,
  newBuildingUri,
  serializeBuildingToTurtle,
  uploadBuilding,
} from "../../../src/services/rdf/building/buildingSerializer.ts";
import { filesContainerFor } from "../../../src/services/attachmentManager.ts";
import { podResources } from "../../../src/services/pod/solidUtils.ts";

export const name = "archive-restore";

export async function run(ctx: TaskContext): Promise<void> {
  const { a, b, check } = ctx;
  const id = `ar-${Date.now()}`;
  const uri = newBuildingUri(a.webId, id);
  const fileUri = uri.split("#")[0];
  const bSharedIn = podResources(b.webId).sharedIn;
  const bSharedInSnap = await snapshot(b.raw, bSharedIn);

  const canRead = async (who: typeof a) => {
    const r = await who.raw.fetch(`${fileUri}?t=${Date.now()}`);
    await r.body?.cancel().catch(() => {});
    return r.ok;
  };

  try {
    // A creates a building and shares it with B (static data only).
    const ttl = serializeBuildingToTurtle(
      { streetAddress: "Archivweg 1", locality: "Nürnberg", lat: "49.45", long: "11.08" },
      uri,
      undefined,
      { agent: a.webId },
    );
    await uploadBuilding(a.session, uri, ttl, a.webId);
    await shareBuildingData(uri, b.webId, a.session, { includeEnergyData: false });
    await drainInbox(b.session); // archive the grant into B's shared-in/
    check("B can read the shared building (baseline)", await canRead(b));

    // Take the backup AFTER sharing, so the shared-out/ grant is captured in it.
    const { bytes, count } = await exportArchive(a.session);
    check("export packed the Pod's resources", count > 0, `count=${count}`);

    // (1) Content round-trip: delete the building, then restore it from the archive.
    await deleteBuilding(a.session, a.webId, uri);
    check("building is gone after delete", !(await canRead(a)));
    const { restored } = await importArchive(a.session, bytes);
    check("import restored resources", restored > 0, `restored=${restored}`);
    check("A can read the building again after restore", await canRead(a));

    // (2) ACL replay: drop B's authorization (simulating the lost .acl that a
    // content-only restore leaves behind), WITHOUT logging a revocation, so the
    // shared-out/ log still says the grant is active.
    await removeFromACL(fileUri, b.webId, a.session);
    await removeFromACL(filesContainerFor(fileUri), b.webId, a.session);
    check("B loses read access once the .acl entry is removed", !(await canRead(b)));

    // reissueGrants folds the log and rebuilds the ACL — B can read again.
    const res = await reissueGrants(a.session);
    check("reissueGrants replayed a building grant", res.buildings >= 1, `buildings=${res.buildings}`);
    check("B can read again after replaying the log (no re-share)", await canRead(b));
  } finally {
    await deleteBuilding(a.session, a.webId, uri).catch(() => {});
    await restore(b.raw, bSharedIn, bSharedInSnap);
  }
}
