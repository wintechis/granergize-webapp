import type { PodGateway } from "../pod/podGateway.ts";
import { DataFactory } from "n3";
import { postSharingEventToInbox } from "./inbox.ts";
import {
  type ActiveGrant,
  appendSharingEvent,
  foldSharingLog,
  sharedInUri,
  sharedOutUri,
} from "./sharingLog.ts";
import { readStoreOrEmpty } from "../pod/podFetch.ts";
import { readModifyWrite } from "../pod/podWrite.ts";
import { filesContainerFor } from "../attachment.ts";
import { readPrefs, toggleHiddenBuilding } from "../prefs.ts";
import { ACL_NS } from "../rdf/vocabularies.ts";
import { buildingTargetsFromStore } from "./grantTargets.ts";
import { logError } from "../../lib/logError.ts";
import { mapPooled } from "../../lib/pool.ts";

interface SharedBuilding {
  buildingUri: string;
  buildingId: string;
  sharedWith: string[];
}

export interface SharedWithMeBuilding {
  buildingUri: string;
  buildingId: string;
  sharedBy: string;
  isVisible: boolean;
}

/** Building id from a building-file IRI (`…/buildings/<id>.ttl` → `<id>`). */
function buildingIdFromUri(uri: string): string {
  return uri.split("/").pop()?.replace(".ttl", "") || "";
}

// ── Pure derivations over a folded log ──────────────────────────────────────
// Each sharing log is folded ONCE per load (the `sharedInLog`/`sharedOutLog`
// queries in hooks/queries.ts); the list shapes below are cheap in-memory
// derivations of that fold. Hook code composes these with the log queries —
// only non-hook callers (headless tasks, service-internal reads) use the
// gateway-taking wrappers further down, which fold for themselves.

/** {@link getSharedBuildings}, derived from already-folded `shared-out/` grants. */
export function sharedBuildingsFromGrants(
  grants: ActiveGrant[],
): SharedBuilding[] {
  const buildingsMap = new Map<string, Set<string>>();
  for (const g of grants) {
    if (g.kind !== "Building") continue;
    if (!buildingsMap.has(g.resource)) buildingsMap.set(g.resource, new Set());
    buildingsMap.get(g.resource)!.add(g.grantee);
  }
  return [...buildingsMap.entries()].map(([buildingUri, webIds]) => ({
    buildingUri,
    buildingId: buildingIdFromUri(buildingUri),
    sharedWith: [...webIds],
  }));
}

/** {@link getSharedWithMe}, derived from already-folded `shared-in/` grants
 * plus the hidden-buildings set from prefs. */
export function sharedWithMeFromGrants(
  grants: ActiveGrant[],
  hiddenBuildings: ReadonlySet<string>,
): SharedWithMeBuilding[] {
  return grants
    .filter((g) => g.kind === "Building")
    .map((g) => ({
      buildingUri: g.resource,
      buildingId: buildingIdFromUri(g.resource),
      sharedBy: g.owner || "Unknown",
      isVisible: !hiddenBuildings.has(g.resource),
    }));
}

/** {@link getReceivedAggregations}, derived from already-folded `shared-in/` grants. */
export function receivedAggregationsFromGrants(grants: ActiveGrant[]): ReceivedAggregation[] {
  return grants
    .filter((g) => g.kind === "Aggregation")
    .map((g) => ({
      snapshotUri: g.resource,
      aggregationId: buildingIdFromUri(g.resource), // basename without ".ttl"
      sharedBy: g.owner || "Unknown",
    }));
}

/** {@link getSharedAggregations}, derived from already-folded `shared-out/` grants. */
export function sharedAggregationsFromGrants(grants: ActiveGrant[]): SharedAggregation[] {
  const aggregationsMap = new Map<string, Set<string>>();
  for (const g of grants) {
    if (g.kind !== "Aggregation") continue;
    if (!aggregationsMap.has(g.resource)) aggregationsMap.set(g.resource, new Set());
    aggregationsMap.get(g.resource)!.add(g.grantee);
  }
  return [...aggregationsMap.entries()].map(([snapshotUri, webIds]) => ({
    snapshotUri,
    aggregationId: buildingIdFromUri(snapshotUri), // basename without ".ttl"
    sharedWith: [...webIds],
  }));
}

/**
 * Buildings the user has shared with others, grouped by building → recipients.
 * Derived by folding the `shared-out/` event log (grant minus revocation); the
 * `.acl` remains the enforcement truth, this log is the app's record. A building
 * IRI is `interop:forResource` with `gran:kind rec:Building`.
 *
 * NON-HOOK callers only (headless tasks, service-internal reads): it folds the
 * whole log for itself. Hook code derives from the `sharedOutLog` query via
 * {@link sharedBuildingsFromGrants} so the log is folded once per load.
 * @operation query
 */
export async function getSharedBuildings(
  gateway: PodGateway,
): Promise<SharedBuilding[]> {
  if (!gateway.webId) {
    throw new Error("User is not logged in");
  }

  // No try/catch: a network/parse failure propagates to React Query (which keeps
  // the last good list via keepPreviousData) rather than being masked as
  // "nothing shared".
  const grants = await foldSharingLog(sharedOutUri(gateway.webId), gateway);
  return sharedBuildingsFromGrants(grants);
}

/**
 * Buildings shared with the user, derived by folding the `shared-in/` event log
 * (each event was archived from the inbox). The sharer is `prov:wasAssociatedWith`
 * (the event's `owner`). Visibility comes from `prefs.ttl`.
 *
 * NON-HOOK callers only — see {@link getSharedBuildings}; hook code derives via
 * {@link sharedWithMeFromGrants} from the `sharedInLog` + `prefs` queries.
 * @operation query
 */
export async function getSharedWithMe(
  gateway: PodGateway,
): Promise<SharedWithMeBuilding[]> {
  if (!gateway.webId) {
    throw new Error("User is not logged in");
  }

  // No try/catch: errors propagate to React Query (keepPreviousData keeps the last
  // good list) instead of being masked as "nothing shared".
  const [{ hiddenBuildings }, grants] = await Promise.all([
    readPrefs(gateway),
    foldSharingLog(sharedInUri(gateway.webId), gateway),
  ]);
  return sharedWithMeFromGrants(grants, hiddenBuildings);
}

/**
 * Revoke access to a building for a specific user
 * @operation mutation
 */
export async function revokeAccess(
  buildingUri: string,
  webId: string,
  gateway: PodGateway,
): Promise<void> {
  const userWebId = gateway.webId;
  if (!userWebId) {
    throw new Error("User is not logged in");
  }

  // Record the revocation in the outgoing log (audit), then withdraw enforcement.
  await appendSharingEvent(sharedOutUri(userWebId), gateway, {
    type: "revocation",
    owner: userWebId,
    grantee: webId,
    resource: buildingUri,
    at: new Date().toISOString(),
  });

  // Remove from ACL
  await removeFromACL(buildingUri, webId, gateway);

  // Withdraw the building's sub-resources too: the files/ container (attachments
  // + certificate), any energy datasets, and a legacy cert outside files/.
  // removeFromACL is idempotent, so revoking a never-granted target is a no-op.
  // Each target is a distinct .acl (deduped to be safe), so the withdrawals run
  // concurrently (bounded); the whole fan-out stays inside the same try/catch,
  // so a failure is still warned-and-tolerated rather than failing the
  // revocation (mapPooled rejects with the first error, exactly like the
  // serial loop did — the catch swallows it identically).
  try {
    const targets = [
      ...new Set(await getSubresourceAclTargets(buildingUri, gateway)),
    ];
    await mapPooled(targets, 4, (target) => removeFromACL(target, webId, gateway));
  } catch (error) {
    console.warn("Could not revoke sub-resource access:", error);
  }

  // Notify the user that access has been revoked
  try {
    await notifyAccessRevoked(buildingUri, webId, gateway);
  } catch (error) {
    console.warn("Could not send revocation notification:", error);
    // Don't throw - revocation succeeded even if notification failed
  }
}

/**
 * Remove a recipient's authorization(s) from a resource's ACL, idempotently and
 * under the optimistic lock.
 *
 * Routed through {@link readModifyWrite} so a revoke racing a concurrent grant (or
 * a second revoke) can't blind-clobber it: the `If-Match`/retry loop re-reads and
 * re-applies. Every authorization subject carrying `acl:agent <webId>` is dropped,
 * so a legacy ACL with duplicate blocks for the same agent is also cleaned up.
 *
 * The owner is protected two ways, so a revoke can never lock the owner out of
 * their own resource: revoking your own WebID is a no-op, and any subject granting
 * `acl:Control` is never dropped (in this app only the owner holds Control). This
 * matters because the owner's full-control block and a recipient grant can carry
 * the SAME `acl:agent` — e.g. a building accidentally shared to one's own WebID —
 * in which case removing every subject for that agent would also strip the owner's
 * Control (observed as a 403 on the owner's own building, Tier-4 meisdata run).
 *
 * A missing ACL or an absent recipient skips the PUT entirely (`mutate` returns
 * false).
 *
 * Exported for unit testing (the public `revokeAccess` reaches it).
 * @operation mutation
 */
export async function removeFromACL(
  resourceUri: string,
  webId: string,
  gateway: PodGateway,
): Promise<void> {
  // Revoking your own access is meaningless and dangerous — see note above.
  if (webId === gateway.webId) return;
  const aclUri = `${resourceUri}.acl`;
  const agentPredicate = DataFactory.namedNode(`${ACL_NS}agent`);
  const modePredicate = DataFactory.namedNode(`${ACL_NS}mode`);
  const controlNode = DataFactory.namedNode(`${ACL_NS}Control`);
  const agentNode = DataFactory.namedNode(webId);
  await readModifyWrite(aclUri, gateway, (store, { created }) => {
    if (created) return false; // no ACL → nothing to revoke
    const subjects = store
      .getQuads(null, agentPredicate, agentNode, null)
      .map((q) => q.subject)
      // Never drop an owner/full-control authorization, even if it shares this
      // agent WebID (only the owner holds acl:Control in this app).
      .filter((s) =>
        store.getQuads(s, modePredicate, controlNode, null).length === 0
      );
    if (subjects.length === 0) return false; // recipient absent → skip the PUT
    for (const subject of subjects) {
      for (const q of store.getQuads(subject, null, null, null)) {
        store.removeQuad(q);
      }
    }
  });
}

/**
 * The building sub-resource URIs whose ACL entry must be removed when revoking:
 * the per-building `files/` container (attachments + certificate, mirroring the
 * `acl:default` grant in `share.ts`), each `cons:EnergyDataset` resource (annual
 * file / series descriptor) plus a series' daily-files container, and a legacy
 * energy certificate stored outside `files/`. Exported for the log replay
 * (`reissueGrants`), which withdraws the same set for revoked pairs.
 */
export async function getSubresourceAclTargets(
  buildingUri: string,
  gateway: PodGateway,
): Promise<string[]> {
  try {
    const store = await readStoreOrEmpty(buildingUri, gateway);
    // Exactly the set the grant side applies ({@link buildingTargetsFromStore}),
    // minus the building file itself — revoke withdraws that separately. No year
    // filter: a full revoke withdraws every sub-resource the recipient may hold.
    return buildingTargetsFromStore(store, buildingUri, {
      includeBuildingFile: false,
    }).map((t) => t.uri);
  } catch (err) {
    logError("collect extra revoke targets for building", err);
    // best-effort — still revoke at least the files container.
    return [filesContainerFor(buildingUri)];
  }
}

/**
 * Revoke every current recipient of a building (each gets the same inbox notice as
 * an explicit revoke). Used when DELETING a shared building: deleting the file
 * alone wouldn't tell recipients, so the building would linger on each recipient's
 * "Buildings shared with you" until their next load 404-prunes it — AND the
 * owner's `shared-out/` log would keep asserting an active grant for a deleted
 * resource (so a later `reissueGrants` would try to re-grant a ghost). Logging a
 * revocation per recipient keeps the log truthful and folds the building out of
 * each recipient's `shared-in/` on their next inbox drain. Best-effort per
 * recipient; the recipient set comes from the owner's `shared-out/` log.
 * @operation mutation
 */
export async function revokeAllBuildingRecipients(
  buildingUri: string,
  gateway: PodGateway,
): Promise<void> {
  const fileUri = buildingUri.split("#")[0];
  const shared = await getSharedBuildings(gateway);
  const recipients = shared
    .find((b) => b.buildingUri.split("#")[0] === fileUri)
    ?.sharedWith ?? [];
  // Deliberately SERIAL: every recipient's revokeAccess read-modify-writes the
  // SAME .acl files (the building's and its sub-resources'), just for a
  // different grantee — not a distinct-resource fan-out. On servers that emit
  // no ETag, readModifyWrite degrades to a plain PUT, so concurrent revokes of
  // recipients A and B could last-write-win and resurrect a just-removed grant.
  for (const webId of recipients) {
    await revokeAccess(fileUri, webId, gateway).catch((err) =>
      logError("revoke building access for recipient", err)
    );
  }
}

/**
 * Toggle visibility of a building shared with the user
 * @operation mutation
 */
export async function toggleBuildingVisibility(
  buildingUri: string,
  gateway: PodGateway,
): Promise<void> {
  if (!gateway.webId) {
    throw new Error("User is not logged in");
  }
  // The hidden list lives in prefs.ttl (read by getSharedWithMe /
  // turtleParsing via readPrefs); toggle there so write and read agree.
  await toggleHiddenBuilding(gateway, buildingUri);
}

/**
 * Record an outgoing building share (a grant) in the `shared-out/` event log.
 * @operation mutation
 */
export async function recordSharing(
  buildingUri: string,
  webId: string,
  gateway: PodGateway,
  includesEnergy = true,
  years?: number[],
  attachmentUris?: string[],
): Promise<void> {
  const userWebId = gateway.webId;
  if (!userWebId) {
    throw new Error("User is not logged in");
  }
  await appendSharingEvent(sharedOutUri(userWebId), gateway, {
    type: "grant",
    owner: userWebId,
    grantee: webId,
    resource: buildingUri,
    kind: "Building",
    includesEnergy,
    years: years && years.length ? years : undefined,
    attachmentUris: attachmentUris && attachmentUris.length ? attachmentUris : undefined,
    at: new Date().toISOString(),
  });
}

/**
 * Notify the recipient that their access to a resource (a building file or an aggregation
 * snapshot) was revoked — a revocation event (the shared-event shape) posted to
 * their inbox, which they archive into shared-in/. Resource-neutral: the message
 * is `interop:forResource <resource>` with no kind, so it folds out a grant of
 * either kind on the recipient's side.
 */
async function notifyAccessRevoked(
  resource: string,
  webId: string,
  gateway: PodGateway,
): Promise<void> {
  await postSharingEventToInbox(webId, gateway, {
    type: "revocation",
    owner: gateway.webId!,
    grantee: webId,
    resource,
    at: new Date().toISOString(),
  });
}

/**
 * Record an outgoing aggregation share (a grant on the snapshot) in `shared-out/`. The
 * aggregationId is recoverable from the snapshot IRI, so it isn't stored separately.
 * @operation mutation
 */
export async function recordAggregationSharing(
  snapshotUri: string,
  webId: string,
  gateway: PodGateway,
): Promise<void> {
  const userWebId = gateway.webId;
  if (!userWebId) {
    throw new Error("User is not logged in");
  }
  await appendSharingEvent(sharedOutUri(userWebId), gateway, {
    type: "grant",
    owner: userWebId,
    grantee: webId,
    resource: snapshotUri,
    kind: "Aggregation",
    at: new Date().toISOString(),
  });
}

interface SharedAggregation {
  snapshotUri: string;
  aggregationId: string;
  sharedWith: string[];
}

export interface ReceivedAggregation {
  /** The sharer's snapshot IRI (`…/aggregations/snapshots/<aggregationId>.ttl`); we have Read on it. */
  snapshotUri: string;
  aggregationId: string;
  sharedBy: string;
}

/**
 * Aggregations shared *with* the user — the recipient counterpart of
 * {@link getSharedAggregations}. Folds the `shared-in/` log (where `drainInbox` archives
 * grants received in the inbox) for `gran:kind cons:Aggregation`. Only the computed
 * snapshot is granted (not the definition), so each entry is just the snapshot
 * IRI + who shared it; render it with {@link loadComputedSnapshot}.
 *
 * NON-HOOK callers only — see {@link getSharedBuildings}; hook code derives via
 * {@link receivedAggregationsFromGrants} from the `sharedInLog` query.
 * @operation query
 */
export async function getReceivedAggregations(
  gateway: PodGateway,
): Promise<ReceivedAggregation[]> {
  if (!gateway.webId) {
    throw new Error("User is not logged in");
  }

  // Errors propagate to React Query (keepPreviousData keeps the last good list).
  const grants = await foldSharingLog(sharedInUri(gateway.webId), gateway);
  return receivedAggregationsFromGrants(grants);
}

/**
 * Aggregations the user has shared with others, by folding the `shared-out/` log for
 * `gran:kind cons:Aggregation` grants. The aggregationId is recovered from the snapshot IRI
 * (`aggregations/snapshots/<aggregationId>.ttl`).
 *
 * NON-HOOK callers only — see {@link getSharedBuildings}; hook code derives via
 * {@link sharedAggregationsFromGrants} from the `sharedOutLog` query.
 * @operation query
 */
export async function getSharedAggregations(gateway: PodGateway): Promise<SharedAggregation[]> {
  if (!gateway.webId) {
    throw new Error("User is not logged in");
  }

  // Errors propagate to React Query / the dialog's own catch (not masked as empty).
  const grants = await foldSharingLog(sharedOutUri(gateway.webId), gateway);
  return sharedAggregationsFromGrants(grants);
}

/**
 * Revoke a recipient's access to an aggregation: log the revocation in
 * `shared-out/`, withdraw it from the snapshot's `.acl`, and notify the recipient
 * so the aggregation drops off their "Aggregations shared with you" on their next inbox drain.
 * @operation mutation
 */
export async function revokeAggregationAccess(
  snapshotUri: string,
  webId: string,
  gateway: PodGateway,
): Promise<void> {
  const userWebId = gateway.webId;
  if (!userWebId) {
    throw new Error("User is not logged in");
  }

  await appendSharingEvent(sharedOutUri(userWebId), gateway, {
    type: "revocation",
    owner: userWebId,
    grantee: webId,
    resource: snapshotUri,
    at: new Date().toISOString(),
  });
  await removeFromACL(snapshotUri, webId, gateway);
  // Best-effort: the ACL withdrawal is the source of truth; the inbox notice is a
  // courtesy that lets the recipient's shared-in/ fold the grant out (same as
  // building revocation). Never let a notify failure fail the revocation.
  await notifyAccessRevoked(snapshotUri, webId, gateway).catch((err) =>
    logError("notify recipient of aggregation-access revocation", err)
  );
}

/**
 * Revoke every current recipient of an aggregation (each gets the same inbox notice as an
 * explicit revoke). Used when DELETING a shared aggregation: deleting the snapshot alone
 * wouldn't tell recipients, so the aggregation would linger on their "Aggregations shared with
 * you" — this folds it out of each recipient's shared-in/ first. Best-effort per
 * recipient; the recipient set comes from the owner's `shared-out/` log.
 * @operation mutation
 */
export async function revokeAllAggregationRecipients(
  snapshotUri: string,
  gateway: PodGateway,
): Promise<void> {
  const shared = await getSharedAggregations(gateway);
  const recipients = shared.find((v) => v.snapshotUri === snapshotUri)
    ?.sharedWith ?? [];
  // Deliberately SERIAL: every recipient's revokeAggregationAccess read-modify-writes
  // the SAME snapshot .acl, just for a different grantee — see the matching
  // note in revokeAllBuildingRecipients (no-ETag servers degrade to a plain
  // PUT, so parallel revokes could clobber each other's removals).
  for (const webId of recipients) {
    await revokeAggregationAccess(snapshotUri, webId, gateway).catch((err) =>
      logError("revoke aggregation access for recipient", err)
    );
  }
}
