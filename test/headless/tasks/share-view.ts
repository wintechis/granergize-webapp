/// <reference lib="deno.ns" />
/**
 * Catalog task `share-view` (headless): A shares an aggregated-view snapshot with
 * B, then REVOKES it. Checks both the fold (B sees it / no longer sees it) and the
 * WAC truth (B can read the snapshot, then can't after revoke).
 */
import { restore, snapshot, type TaskContext } from "../taskContext.ts";
import { shareAggregatedView } from "../../../src/services/interop/share.ts";
import { drainInbox } from "../../../src/services/interop/inbox.ts";
import {
  getReceivedViews,
  revokeViewAccess,
} from "../../../src/services/interop/sharingManager.ts";
import { podResources } from "../../../src/services/pod/solidUtils.ts";

export const name = "share-view";

export async function run(ctx: TaskContext): Promise<void> {
  const { a, b, check } = ctx;
  const viewId = `view-${Date.now()}`;
  const snapshotUri = `${podResources(a.webId).viewSnapshots}${viewId}.ttl`;
  const bSharedIn = podResources(b.webId).sharedIn;
  const bSharedInSnap = await snapshot(b.raw, bSharedIn);

  try {
    // A PUTs a minimal snapshot resource (CSS auto-creates the container chain).
    await a.raw.fetch(snapshotUri, {
      method: "PUT",
      headers: { "Content-Type": "text/turtle" },
      body: `<#view> <http://www.w3.org/2000/01/rdf-schema#label> "E2E View" .\n`,
    });

    await shareAggregatedView(snapshotUri, b.webId, a.session);
    await drainInbox(b.session);
    let received = await getReceivedViews(b.session);
    check(
      "B sees the shared view",
      received.some((v) => v.snapshotUri === snapshotUri),
      `[${received.map((v) => v.snapshotUri).join(", ")}]`,
    );
    const bRead = await b.raw.fetch(`${snapshotUri}?t=${Date.now()}`);
    check("B can READ the snapshot (ACL granted)", bRead.ok, `HTTP ${bRead.status}`);

    await revokeViewAccess(snapshotUri, b.webId, a.session);
    await drainInbox(b.session); // drain the revocation notice
    received = await getReceivedViews(b.session);
    check(
      "B no longer sees the view after revoke",
      !received.some((v) => v.snapshotUri === snapshotUri),
    );
    const bRead2 = await b.raw.fetch(`${snapshotUri}?t=${Date.now()}`);
    check(
      "B can no longer READ the snapshot (ACL withdrawn)",
      bRead2.status === 403 || bRead2.status === 404,
      `HTTP ${bRead2.status}`,
    );
  } finally {
    await a.raw.fetch(snapshotUri, { method: "DELETE" }).catch(() => {});
    await a.raw.fetch(`${snapshotUri}.acl`, { method: "DELETE" }).catch(() => {});
    await restore(b.raw, bSharedIn, bSharedInSnap);
  }
}
