/// <reference lib="deno.ns" />
/**
 * Catalog task `sharing-intent` (headless): drive A→B sharing through the
 * React-free `invoke()` callable layer (`src/intents/registry.ts`) — NOT the raw
 * share service — and assert that **B actually sees the share** on the Pod (drain
 * B's inbox, then read B's shared-in fold), plus the WAC truth (B can fetch the
 * resource). Setup goes through `invoke("AddBuilding")` so the whole path — create
 * AND share — runs without React. This is the Step-5 merge gate for the sharing
 * cores. The adapters' React-Query cache patch is browser-only and out of scope.
 */
import { restore, snapshot, type TaskContext } from "../taskContext.ts";
import { invoke } from "../../../src/intents/registry.ts";
import { drainInbox } from "../../../src/services/interop/inbox.ts";
import {
  getReceivedAggregations,
  getSharedWithMe,
} from "../../../src/services/interop/sharingManager.ts";
import { buildingFileUri } from "../../../src/services/rdf/building/buildingId.ts";
import { deleteBuilding } from "../../../src/services/rdf/building/buildingSerializer.ts";
import { podResources } from "../../../src/services/pod/solidUtils.ts";

export const name = "sharing-intent";

export async function run(ctx: TaskContext): Promise<void> {
  const { a, b, check } = ctx;
  const bSharedIn = podResources(b.webId).sharedIn;
  const bSharedInSnap = await snapshot(b.raw, bSharedIn);

  const aggregationId = `si-aggregation-${Date.now()}`;
  const snapshotUri = `${podResources(a.webId).aggregations}snapshots/${aggregationId}.ttl`;

  let buildingUri = "";
  try {
    // ── Setup: A adds a building via the intent layer (create runs headless) ──
    const addOutcome = await invoke(
      "AddBuilding",
      {
        buildings: [
          {
            streetAddress: "Teststraße 7",
            locality: "Nürnberg",
            lat: "49.45",
            long: "11.08",
          },
        ],
      },
      a.session,
    );
    check("invoke(AddBuilding) wrote one building", addOutcome.added.length === 1);
    buildingUri = addOutcome.added[0];

    // ── ShareBuilding A→B via the intent layer ───────────────────────────────
    const shareOutcome = await invoke(
      "ShareBuilding",
      { buildingUri, recipients: [b.webId], includeEnergyData: false },
      a.session,
    );
    check(
      "invoke(ShareBuilding) granted B",
      shareOutcome.recipientsShared === 1,
      String(shareOutcome.recipientsShared),
    );

    // B SEES it: drain B's inbox (archives the grant into shared-in/), then fold.
    await drainInbox(b.session);
    const shared = await getSharedWithMe(b.session);
    const fileUri = buildingFileUri(buildingUri);
    check(
      "B sees the shared building under 'shared with you'",
      shared.some((s) => buildingFileUri(s.buildingUri) === fileUri),
      `shared=[${shared.map((s) => s.buildingUri).join(", ")}]`,
    );
    const bReadBuilding = await b.raw.fetch(`${fileUri}?t=${Date.now()}`);
    check(
      "B can actually READ the shared building (ACL enforcement)",
      bReadBuilding.ok,
      `HTTP ${bReadBuilding.status}`,
    );

    // ── ShareAggregation A→B via the intent layer ────────────────────────────
    // Seed a minimal snapshot resource (CSS auto-creates the container chain).
    await a.raw.fetch(snapshotUri, {
      method: "PUT",
      headers: { "Content-Type": "text/turtle" },
      body:
        `<#aggregation> <http://www.w3.org/2000/01/rdf-schema#label> "Intent Aggregation" .\n`,
    });
    const aggOutcome = await invoke(
      "ShareAggregation",
      { snapshotUri, recipients: [b.webId] },
      a.session,
    );
    check(
      "invoke(ShareAggregation) granted B",
      aggOutcome.done === 1 && aggOutcome.total === 1,
      `${aggOutcome.done}/${aggOutcome.total}`,
    );

    await drainInbox(b.session);
    const received = await getReceivedAggregations(b.session);
    check(
      "B sees the shared aggregation",
      received.some((v) => v.snapshotUri === snapshotUri),
      `[${received.map((v) => v.snapshotUri).join(", ")}]`,
    );
    const bReadSnap = await b.raw.fetch(`${snapshotUri}?t=${Date.now()}`);
    check(
      "B can actually READ the shared aggregation snapshot (ACL granted)",
      bReadSnap.ok,
      `HTTP ${bReadSnap.status}`,
    );
  } finally {
    if (buildingUri) {
      await deleteBuilding(a.session, a.webId, buildingUri).catch(() => {});
    }
    await a.raw.fetch(snapshotUri, { method: "DELETE" }).catch(() => {});
    await a.raw.fetch(`${snapshotUri}.acl`, { method: "DELETE" }).catch(() => {});
    await restore(b.raw, bSharedIn, bSharedInSnap);
  }
}
