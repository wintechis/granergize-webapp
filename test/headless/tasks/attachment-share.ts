/// <reference lib="deno.ns" />
/**
 * Catalog task `attachment-share` (headless): A attaches a file to a building and
 * shares the building with B. Proves the real end-to-end story this feature is
 * about — B can FETCH the attachment binary (WAC enforcement via the per-building
 * `files/` container grant), and after A revokes, B can no longer read it.
 */
import { Parser } from "n3";
import { restore, snapshot, type TaskContext } from "../taskContext.ts";
import { shareBuildingData } from "../../../src/services/interop/share.ts";
import {
  getSharedWithMe,
  revokeAccess,
} from "../../../src/services/interop/sharingManager.ts";
import { drainInbox } from "../../../src/services/interop/inbox.ts";
import { uploadAttachment } from "../../../src/services/attachmentManager.ts";
import { parseBuildings } from "../../../src/services/rdf/building/buildingParser.ts";
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

export const name = "attachment-share";

export async function run(ctx: TaskContext): Promise<void> {
  const { a, b, check } = ctx;
  const id = `at-${Date.now()}`;
  const uri = newBuildingUri(a.webId, id);
  const fileUri = buildingFileUrl(uri);
  const bSharedIn = podResources(b.webId).sharedIn;
  const bSharedInSnap = await snapshot(b.raw, bSharedIn);

  let attachmentUrl = "";
  try {
    // A creates a building, then attaches a file to it.
    const ttl = serializeBuildingToTurtle(
      { streetAddress: "Teststraße 1", locality: "Nürnberg", lat: "49.45", long: "11.08" },
      uri,
      undefined,
      { agent: a.webId },
    );
    await uploadBuilding(a.session, uri, ttl, a.webId);
    const subject = [...parseBuildings(new Parser({ baseIRI: uri }).parse(ttl))
      .values()][0].uri;

    const ref = await uploadAttachment(
      fileUri,
      subject,
      new File(["hello attachment"], "report.pdf", { type: "application/pdf" }),
      a.session,
    );
    attachmentUrl = ref.url;

    // A shares the building directly with B (no room needed for a known WebID).
    await shareBuildingData(fileUri, b.webId, a.session, {
      includeEnergyData: false,
    });
    await drainInbox(b.session); // archive the grant into B's shared-in/

    const shared = await getSharedWithMe(b.session);
    check(
      "B sees the shared building",
      shared.some((s) => buildingFileUrl(s.buildingUri) === fileUri),
      `shared=[${shared.map((s) => s.buildingUri).join(", ")}]`,
    );

    // The headline: B can actually fetch the attachment binary.
    const bRead = await b.raw.fetch(`${ref.url}?t=${Date.now()}`);
    await bRead.body?.cancel().catch(() => {});
    check(
      "B can READ the shared attachment (ACL via files/ container grant)",
      bRead.ok,
      `HTTP ${bRead.status}`,
    );

    // After revoke, the attachment is no longer readable by B.
    await revokeAccess(fileUri, b.webId, a.session);
    const bRead2 = await b.raw.fetch(`${ref.url}?t=${Date.now()}`);
    await bRead2.body?.cancel().catch(() => {});
    check(
      "B can no longer read the attachment after revoke",
      !bRead2.ok,
      `HTTP ${bRead2.status}`,
    );
  } finally {
    if (attachmentUrl) {
      await a.session.fetch(attachmentUrl, { method: "DELETE" }).catch(() => {});
    }
    await deleteBuilding(a.session, a.webId, uri).catch(() => {});
    await restore(b.raw, bSharedIn, bSharedInSnap);
  }
}
