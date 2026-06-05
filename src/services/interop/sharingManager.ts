import { Session } from "@inrupt/solid-client-authn-browser";
import { DataFactory, Parser, Store, Writer } from "n3";
import { getRecipientInboxUrl } from "./inbox.ts";
import {
  appendSharingEvent,
  buildSharingEventTurtle,
  foldSharingLog,
  sharedInUrl,
  sharedOutUrl,
} from "./sharingLog.ts";
import { fetchFresh } from "../utils/podFetch.ts";
import { readPrefs, toggleHiddenBuilding } from "../utils/prefs.ts";
import { GRAN_NS } from "../utils/vocabularies.ts";
import { parseDatasetSlug } from "../utils/energyDataset.ts";
import { isSeriesGranularity } from "../utils/durationUtils.ts";

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

  try {
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
  } catch (error) {
    console.error("Error getting shared buildings:", error);
    return [];
  }
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

  try {
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
  } catch (error) {
    console.error("Error getting shared with me buildings:", error);
    return [];
  }
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

  // If building has energy data, revoke that too
  try {
    const energyTargets = await getEnergyAclTargets(buildingUri, session);
    for (const target of energyTargets) {
      await removeFromACL(target, webId, session);
    }
  } catch (error) {
    console.warn("Could not revoke energy data access:", error);
  }

  // Notify the user that access has been revoked
  try {
    await notifyAccessRevoked(buildingUri, webId, session);
  } catch (error) {
    console.warn("Could not send revocation notification:", error);
    // Don't throw - revocation succeeded even if notification failed
  }
}

async function removeFromACL(
  resourceUri: string,
  webId: string,
  session: Session,
): Promise<void> {
  const aclUrl = `${resourceUri}.acl`;
  const response = await fetchFresh(aclUrl, session);

  if (!response.ok) {
    console.warn(`ACL not found for ${resourceUri}`);
    return;
  }

  const aclText = await response.text();
  const parser = new Parser({ format: "text/turtle", baseIRI: aclUrl });
  const store = new Store(parser.parse(aclText));

  // Find all authorization subjects that have acl:agent <webId>
  const agentPredicate = DataFactory.namedNode(
    "http://www.w3.org/ns/auth/acl#agent",
  );
  const agentNode = DataFactory.namedNode(webId);
  const authsToRemove = store
    .getQuads(null, agentPredicate, agentNode, null)
    .map((q) => q.subject);

  if (authsToRemove.length === 0) return;

  // Remove all quads where those subjects appear as subject
  for (const subject of authsToRemove) {
    store.getQuads(subject, null, null, null).forEach((q) =>
      store.removeQuad(q)
    );
  }

  const writer = new Writer({ format: "text/turtle" });
  const updatedAcl = writer.quadsToString(
    store.getQuads(null, null, null, null),
  );

  await session.fetch(aclUrl, {
    method: "PUT",
    headers: { "Content-Type": "text/turtle" },
    body: updatedAcl,
  });
}

/**
 * The energy resource URIs whose ACL entry must be removed when revoking energy
 * access: each `gran:EnergyDataset` resource (annual file / series descriptor)
 * plus a series' daily-files container. Mirrors `share.ts getEnergyDataUrls`.
 */
async function getEnergyAclTargets(
  buildingUri: string,
  session: Session,
): Promise<string[]> {
  try {
    const response = await fetchFresh(buildingUri, session);
    const store = new Store(
      new Parser({ baseIRI: buildingUri }).parse(await response.text()),
    );

    const targets: string[] = [];
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
    return targets;
  } catch {
    return [];
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
    at: new Date().toISOString(),
  });
}

/**
 * Notify the recipient that their access was revoked — a revocation event (the
 * shared-event shape) posted to their inbox, which they archive into shared-in/.
 */
async function notifyAccessRevoked(
  buildingUri: string,
  webId: string,
  session: Session,
): Promise<void> {
  const inboxUrl = await getRecipientInboxUrl(webId, session);

  const message = buildSharingEventTurtle({
    type: "revocation",
    owner: session.info.webId!,
    grantee: webId,
    resource: buildingUri,
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

  try {
    const grants = await foldSharingLog(sharedInUrl(session.info.webId), session);
    return grants
      .filter((g) => g.kind === "View")
      .map((g) => ({
        snapshotUrl: g.resource,
        viewId: buildingIdFromUri(g.resource), // basename without ".ttl"
        sharedBy: g.owner || "Unknown",
      }));
  } catch (error) {
    console.error("Error getting received views:", error);
    return [];
  }
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

  try {
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
  } catch (error) {
    console.error("Error getting shared views:", error);
    return [];
  }
}

/**
 * Revoke a recipient's access to an aggregated view: log the revocation in
 * `shared-out/` and withdraw it from the snapshot's `.acl`.
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
}
