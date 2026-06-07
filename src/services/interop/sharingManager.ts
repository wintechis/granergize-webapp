import { Session } from "@inrupt/solid-client-authn-browser";
import { DataFactory, Parser, Store } from "n3";
import { getRecipientInboxUrl } from "./inbox.ts";
import {
  appendSharingEvent,
  buildSharingEventTurtle,
  foldSharingLog,
  sharedInUrl,
  sharedOutUrl,
} from "./sharingLog.ts";
import { fetchFresh } from "../utils/podFetch.ts";
import { readModifyWrite } from "../utils/podWrite.ts";
import { filesContainerFor } from "../utils/attachmentManager.ts";
import { readPrefs, toggleHiddenBuilding } from "../utils/prefs.ts";
import {
  ACL_NS,
  GRAN_HAS_ENERGY_CERTIFICATE,
  GRAN_NS,
} from "../utils/vocabularies.ts";
import { parseDatasetSlug } from "../utils/energyDataset.ts";
import { isSeriesGranularity } from "../utils/durationUtils.ts";
import { logError } from "../utils/logError.ts";

interface SharedBuilding {
  buildingUri: string;
  buildingId: string;
  sharedWith: string[];
}

interface SharedWithMeBuilding {
  buildingUri: string;
  buildingId: string;
  sharedBy: string;
  isVisible: boolean;
  sharedRole?: string;
}

/** Building id from a building-file URL (`…/buildings/<id>.ttl` → `<id>`). */
function buildingIdFromUri(uri: string): string {
  return uri.split("/").pop()?.replace(".ttl", "") || "";
}

/**
 * Buildings the user has shared with others, grouped by building → recipients.
 * Derived by folding the `shared-out/` event log (grant minus revocation); the
 * `.acl` remains the enforcement truth, this log is the app's record. A building
 * URL is `interop:forResource` with `gran:kind gran:Building`.
 */
export async function getSharedBuildings(
  session: Session,
): Promise<SharedBuilding[]> {
  if (!session.info.isLoggedIn || !session.info.webId) {
    throw new Error("User is not logged in");
  }

  // No try/catch: a network/parse failure propagates to React Query (which keeps
  // the last good list via keepPreviousData) rather than being masked as
  // "nothing shared".
  const grants = await foldSharingLog(sharedOutUrl(session.info.webId), session);
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

/**
 * Buildings shared with the user, derived by folding the `shared-in/` event log
 * (each event was archived from the inbox). The sharer is `prov:wasAssociatedWith`
 * (the event's `owner`). Visibility comes from `prefs.ttl`.
 */
export async function getSharedWithMe(
  session: Session,
): Promise<SharedWithMeBuilding[]> {
  if (!session.info.isLoggedIn || !session.info.webId) {
    throw new Error("User is not logged in");
  }

  // No try/catch: errors propagate to React Query (keepPreviousData keeps the last
  // good list) instead of being masked as "nothing shared".
  const [{ hiddenBuildings }, grants] = await Promise.all([
    readPrefs(session),
    foldSharingLog(sharedInUrl(session.info.webId), session),
  ]);

  return grants
    .filter((g) => g.kind === "Building")
    .map((g) => ({
      buildingUri: g.resource,
      buildingId: buildingIdFromUri(g.resource),
      sharedBy: g.owner || "Unknown",
      isVisible: !hiddenBuildings.has(g.resource),
    }));
}

/**
 * Revoke access to a building for a specific user
 */
export async function revokeAccess(
  buildingUri: string,
  webId: string,
  session: Session,
): Promise<void> {
  const userWebId = session.info.webId;
  if (!session.info.isLoggedIn || !userWebId) {
    throw new Error("User is not logged in");
  }

  // Record the revocation in the outgoing log (audit), then withdraw enforcement.
  await appendSharingEvent(sharedOutUrl(userWebId), session, {
    type: "revocation",
    owner: userWebId,
    grantee: webId,
    resource: buildingUri,
    at: new Date().toISOString(),
  });

  // Remove from ACL
  await removeFromACL(buildingUri, webId, session);

  // Withdraw the building's sub-resources too: the files/ container (attachments
  // + certificate), any energy datasets, and a legacy cert outside files/.
  // removeFromACL is idempotent, so revoking a never-granted target is a no-op.
  try {
    for (const target of await getSubresourceAclTargets(buildingUri, session)) {
      await removeFromACL(target, webId, session);
    }
  } catch (error) {
    console.warn("Could not revoke sub-resource access:", error);
  }

  // Notify the user that access has been revoked
  try {
    await notifyAccessRevoked(buildingUri, webId, session);
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
 * so a legacy ACL with duplicate blocks for the same agent is also cleaned up. The
 * owner block (a different `acl:agent`) is untouched. A missing ACL or an absent
 * recipient skips the PUT entirely (`mutate` returns false).
 *
 * Exported for unit testing (the public `revokeAccess` reaches it).
 */
export async function removeFromACL(
  resourceUri: string,
  webId: string,
  session: Session,
): Promise<void> {
  const aclUrl = `${resourceUri}.acl`;
  const agentPredicate = DataFactory.namedNode(`${ACL_NS}agent`);
  const agentNode = DataFactory.namedNode(webId);
  await readModifyWrite(aclUrl, session, (store, { created }) => {
    if (created) return false; // no ACL → nothing to revoke
    const subjects = store
      .getQuads(null, agentPredicate, agentNode, null)
      .map((q) => q.subject);
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
 * `acl:default` grant in `share.ts`), each `gran:EnergyDataset` resource (annual
 * file / series descriptor) plus a series' daily-files container, and a legacy
 * energy certificate stored outside `files/`.
 */
async function getSubresourceAclTargets(
  buildingUri: string,
  session: Session,
): Promise<string[]> {
  const filesContainer = filesContainerFor(buildingUri);
  const targets: string[] = [filesContainer];
  try {
    const response = await fetchFresh(buildingUri, session);
    const store = new Store(
      new Parser({ baseIRI: buildingUri }).parse(await response.text()),
    );

    for (
      const link of store.getObjects(
        null,
        DataFactory.namedNode(`${GRAN_NS}hasEnergyDataset`),
        null,
      )
    ) {
      const ref = parseDatasetSlug(link.value);
      if (!ref) continue;
      const file = link.value.split("#")[0];
      targets.push(file);
      if (isSeriesGranularity(ref.granularity)) {
        targets.push(file.replace(/\.ttl$/, "/"));
      }
    }
    const cert = store.getObjects(
      null,
      DataFactory.namedNode(GRAN_HAS_ENERGY_CERTIFICATE),
      null,
    )[0];
    if (cert && !cert.value.startsWith(filesContainer)) targets.push(cert.value);
  } catch (err) {
    logError("collect extra revoke targets for building", err);
    // best-effort — the files container is still revoked above
  }
  return targets;
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
 */
export async function revokeAllBuildingRecipients(
  buildingUri: string,
  session: Session,
): Promise<void> {
  const fileUri = buildingUri.split("#")[0];
  const shared = await getSharedBuildings(session);
  const recipients = shared
    .find((b) => b.buildingUri.split("#")[0] === fileUri)
    ?.sharedWith ?? [];
  for (const webId of recipients) {
    await revokeAccess(fileUri, webId, session).catch((err) =>
      logError("revoke building access for recipient", err)
    );
  }
}

/**
 * Toggle visibility of a building shared with the user
 */
export async function toggleBuildingVisibility(
  buildingUri: string,
  session: Session,
): Promise<void> {
  if (!session.info.isLoggedIn || !session.info.webId) {
    throw new Error("User is not logged in");
  }
  // The hidden list lives in prefs.ttl (read by getSharedWithMe /
  // TurtleParsingService via readPrefs); toggle there so write and read agree.
  await toggleHiddenBuilding(session, buildingUri);
}

/**
 * Record an outgoing building share (a grant) in the `shared-out/` event log.
 */
export async function recordSharing(
  buildingUri: string,
  webId: string,
  session: Session,
  includesEnergy = true,
  years?: number[],
): Promise<void> {
  const userWebId = session.info.webId;
  if (!session.info.isLoggedIn || !userWebId) {
    throw new Error("User is not logged in");
  }
  await appendSharingEvent(sharedOutUrl(userWebId), session, {
    type: "grant",
    owner: userWebId,
    grantee: webId,
    resource: buildingUri,
    kind: "Building",
    includesEnergy,
    years: years && years.length ? years : undefined,
    at: new Date().toISOString(),
  });
}

/**
 * Notify the recipient that their access to a resource (a building file or a view
 * snapshot) was revoked — a revocation event (the shared-event shape) posted to
 * their inbox, which they archive into shared-in/. Resource-neutral: the message
 * is `interop:forResource <resource>` with no kind, so it folds out a grant of
 * either kind on the recipient's side.
 */
async function notifyAccessRevoked(
  resource: string,
  webId: string,
  session: Session,
): Promise<void> {
  const inboxUrl = await getRecipientInboxUrl(webId, session);

  const message = buildSharingEventTurtle({
    type: "revocation",
    owner: session.info.webId!,
    grantee: webId,
    resource,
    at: new Date().toISOString(),
  });

  const postResponse = await session.fetch(inboxUrl, {
    method: "POST",
    headers: { "Content-Type": "text/turtle" },
    body: message,
  });

  if (!postResponse.ok) {
    throw new Error(
      `Failed to post revocation message to inbox at ${inboxUrl}: ${postResponse.statusText}`,
    );
  }
}

/**
 * Record an outgoing view share (a grant on the snapshot) in `shared-out/`. The
 * viewId is recoverable from the snapshot URL, so it isn't stored separately.
 */
export async function recordViewSharing(
  snapshotUrl: string,
  webId: string,
  session: Session,
): Promise<void> {
  const userWebId = session.info.webId;
  if (!session.info.isLoggedIn || !userWebId) {
    throw new Error("User is not logged in");
  }
  await appendSharingEvent(sharedOutUrl(userWebId), session, {
    type: "grant",
    owner: userWebId,
    grantee: webId,
    resource: snapshotUrl,
    kind: "View",
    at: new Date().toISOString(),
  });
}

interface SharedView {
  snapshotUrl: string;
  viewId: string;
  sharedWith: string[];
}

interface ReceivedView {
  /** The sharer's snapshot URL (`…/views/snapshots/<viewId>.ttl`); we have Read on it. */
  snapshotUrl: string;
  viewId: string;
  sharedBy: string;
}

/**
 * Aggregated views shared *with* the user — the recipient counterpart of
 * {@link getSharedViews}. Folds the `shared-in/` log (where `readInbox` archives
 * grants received in the inbox) for `gran:kind gran:View`. Only the computed
 * snapshot is granted (not the definition), so each entry is just the snapshot
 * URL + who shared it; render it with {@link loadComputedSnapshot}.
 */
export async function getReceivedViews(
  session: Session,
): Promise<ReceivedView[]> {
  if (!session.info.isLoggedIn || !session.info.webId) {
    throw new Error("User is not logged in");
  }

  // Errors propagate to React Query (keepPreviousData keeps the last good list).
  const grants = await foldSharingLog(sharedInUrl(session.info.webId), session);
  return grants
    .filter((g) => g.kind === "View")
    .map((g) => ({
      snapshotUrl: g.resource,
      viewId: buildingIdFromUri(g.resource), // basename without ".ttl"
      sharedBy: g.owner || "Unknown",
    }));
}

/**
 * Views the user has shared with others, by folding the `shared-out/` log for
 * `gran:kind gran:View` grants. The viewId is recovered from the snapshot URL
 * (`views/snapshots/<viewId>.ttl`).
 */
export async function getSharedViews(session: Session): Promise<SharedView[]> {
  if (!session.info.isLoggedIn || !session.info.webId) {
    throw new Error("User is not logged in");
  }

  // Errors propagate to React Query / the dialog's own catch (not masked as empty).
  const grants = await foldSharingLog(sharedOutUrl(session.info.webId), session);
  const viewsMap = new Map<string, Set<string>>();
  for (const g of grants) {
    if (g.kind !== "View") continue;
    if (!viewsMap.has(g.resource)) viewsMap.set(g.resource, new Set());
    viewsMap.get(g.resource)!.add(g.grantee);
  }
  return [...viewsMap.entries()].map(([snapshotUrl, webIds]) => ({
    snapshotUrl,
    viewId: buildingIdFromUri(snapshotUrl), // basename without ".ttl"
    sharedWith: [...webIds],
  }));
}

/**
 * Revoke a recipient's access to an aggregated view: log the revocation in
 * `shared-out/`, withdraw it from the snapshot's `.acl`, and notify the recipient
 * so the view drops off their "Views shared with you" on their next inbox drain.
 */
export async function revokeViewAccess(
  snapshotUrl: string,
  webId: string,
  session: Session,
): Promise<void> {
  const userWebId = session.info.webId;
  if (!session.info.isLoggedIn || !userWebId) {
    throw new Error("User is not logged in");
  }

  await appendSharingEvent(sharedOutUrl(userWebId), session, {
    type: "revocation",
    owner: userWebId,
    grantee: webId,
    resource: snapshotUrl,
    at: new Date().toISOString(),
  });
  await removeFromACL(snapshotUrl, webId, session);
  // Best-effort: the ACL withdrawal is the source of truth; the inbox notice is a
  // courtesy that lets the recipient's shared-in/ fold the grant out (same as
  // building revocation). Never let a notify failure fail the revocation.
  await notifyAccessRevoked(snapshotUrl, webId, session).catch((err) =>
    logError("notify recipient of view-access revocation", err)
  );
}

/**
 * Revoke every current recipient of a view (each gets the same inbox notice as an
 * explicit revoke). Used when DELETING a shared view: deleting the snapshot alone
 * wouldn't tell recipients, so the view would linger on their "Views shared with
 * you" — this folds it out of each recipient's shared-in/ first. Best-effort per
 * recipient; the recipient set comes from the owner's `shared-out/` log.
 */
export async function revokeAllViewRecipients(
  snapshotUrl: string,
  session: Session,
): Promise<void> {
  const shared = await getSharedViews(session);
  const recipients = shared.find((v) => v.snapshotUrl === snapshotUrl)
    ?.sharedWith ?? [];
  for (const webId of recipients) {
    await revokeViewAccess(snapshotUrl, webId, session).catch((err) =>
      logError("revoke view access for recipient", err)
    );
  }
}
