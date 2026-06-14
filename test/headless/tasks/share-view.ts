/// <reference lib="deno.ns" />
/**
 * Catalog task `share-view` (headless): A shares an aggregation snapshot with
 * B, then REVOKES it. Checks both the fold (B sees it / no longer sees it) and the
 * WAC truth (B can read the snapshot, then can't after revoke).
 */
import { restore, snapshot, type TaskContext } from "../taskContext.ts";
import { shareAggregation } from "../../../src/services/interop/share.ts";
import { drainInbox } from "../../../src/services/interop/inbox.ts";
import {
  getReceivedAggregations,
  revokeAggregationAccess,
} from "../../../src/services/interop/sharingManager.ts";
import { podResources } from "../../../src/services/pod/solidUtils.ts";

export const name = "share-view";

export async function run(ctx: TaskContext): Promise<void> {
  const { a, b, check } = ctx;
  const aggregationId = `aggregation-${Date.now()}`;
  const snapshotUri = `${podResources(a.webId).aggregations}snapshots/${aggregationId}.ttl`;
  const bSharedIn = podResources(b.webId).sharedIn;
  const bSharedInSnap = await snapshot(b.raw, bSharedIn);

  try {
    // A PUTs a minimal snapshot resource (CSS auto-creates the container chain).
    await a.raw.fetch(snapshotUri, {
      method: "PUT",
      headers: { "Content-Type": "text/turtle" },
      body: `<#aggregation> <http://www.w3.org/2000/01/rdf-schema#label> "E2E Aggregation" .\n`,
    });

    await shareAggregation(snapshotUri, b.webId, a.session);
    await drainInbox(b.session);
    let received = await getReceivedAggregations(b.session);
    check(
      "B sees the shared aggregation",
      received.some((v) => v.snapshotUri === snapshotUri),
      `[${received.map((v) => v.snapshotUri).join(", ")}]`,
    );
    const bRead = await b.raw.fetch(`${snapshotUri}?t=${Date.now()}`);
    check("B can READ the snapshot (ACL granted)", bRead.ok, `HTTP ${bRead.status}`);

    await revokeAggregationAccess(snapshotUri, b.webId, a.session);
    await drainInbox(b.session); // drain the revocation notice
    received = await getReceivedAggregations(b.session);
    check(
      "B no longer sees the aggregation after revoke",
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
