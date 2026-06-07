import { Session } from "@inrupt/solid-client-authn-browser";
import { DataFactory, Parser, Store } from "n3";
import { recordSharing, recordViewSharing } from "./sharingManager.ts";
import { getRecipientInboxUrl } from "./inbox.ts";
import {
  buildSharingEventTurtle,
  foldSharingLog,
  sharedOutUrl,
} from "./sharingLog.ts";
import {
  ACL_NS,
  GRAN_HAS_ENERGY_CERTIFICATE,
  GRAN_NS,
  RDF_TYPE,
} from "../utils/vocabularies.ts";
import { parseDatasetSlug } from "../utils/energyDataset.ts";
import { isSeriesGranularity } from "../utils/durationUtils.ts";
import { ensureContainer, readModifyWrite } from "../utils/podWrite.ts";
import { filesContainerFor } from "../utils/attachmentManager.ts";
import { getStorageRoot } from "../utils/solidUtils.ts";

export interface ShareOptions {
  includeEnergyData: boolean;
  /** Restrict the energy grant to these years only. Absent = all years (today's behavior). */
  years?: number[];
}

export async function shareBuildingData(
  buildingUri: string,
  webId: string,
  session: Session,
  options: ShareOptions = { includeEnergyData: true },
) {
  const buildingFile = buildingUri.split("#")[0];

  // Write the WAC grants (the enforcement side).
  await applyBuildingGrant(buildingFile, webId, session, options);

  // Notify the recipient (inbox) and record the outgoing share in our
  // append-only shared-out/ log. These two are the *record/notify* side and are
  // deliberately NOT part of applyBuildingGrant, so a log replay (reissueGrants)
  // can re-apply ACLs without re-notifying or re-appending to the log.
  await postToInbox(buildingFile, webId, session, options);
  await recordSharing(
    buildingFile,
    webId,
    session,
    options.includeEnergyData,
    options.years,
  );
}

/**
 * Apply the WAC read grants for sharing a building with `webId` — and ONLY that
 * (no inbox post, no `shared-out/` append). The ACL is a *derived projection* of
 * the sharing log, so this is the piece replayed by {@link reissueGrants} to
 * rebuild enforcement from the log (e.g. after an archive restore). Idempotent:
 * every `grantReadAccess` replaces the recipient's authorization rather than
 * duplicating it, so re-applying an already-active grant is a no-op.
 *
 * Grants: the building file, its `files/` container (attachments + certificate,
 * with `acl:default`), a legacy cert outside `files/`, and — when energy is
 * included — each `gran:EnergyDataset` (restricted to `options.years` if given)
 * plus a series' daily-files container.
 */
export async function applyBuildingGrant(
  buildingFile: string,
  webId: string,
  session: Session,
  options: ShareOptions = { includeEnergyData: true },
): Promise<void> {
  // Always share the building's static data
  await grantReadAccess(buildingFile, webId, session);

  // Share the per-building files/ container (attachments + the energy
  // certificate). One acl:default grant covers every file in it — including
  // uploads added after this share — so the recipient can download them. The
  // container is provisioned first so the grant has something to attach to.
  const filesContainer = filesContainerFor(buildingFile);
  await ensureContainer(filesContainer.replace(/files\/$/, ""), session);
  await ensureContainer(filesContainer, session);
  await grantReadAccess(filesContainer, webId, session, true);

  // A legacy energy certificate stored OUTSIDE files/ (the old shared
  // certificates/ folder) isn't covered by the container grant — grant the file
  // itself so existing shares keep working without a re-upload.
  const certUrl = await getEnergyCertificateUrl(buildingFile, session);
  if (certUrl && !certUrl.startsWith(filesContainer)) {
    await grantReadAccess(certUrl, webId, session, false);
  }

  // Conditionally share energy data: grant access to each gran:EnergyDataset
  // resource (annual file / series descriptor), plus a series' daily-files
  // container (with acl:default, so the files inside are covered).
  if (options.includeEnergyData) {
    for (const t of await getEnergyDataUrls(buildingFile, session, options.years)) {
      await grantReadAccess(t.url, webId, session, t.isContainer);
    }
  }
}

export interface ReissueResult {
  /** Active building grants re-applied. */
  buildings: number;
  /** Active view grants re-applied. */
  views: number;
  /** Active grants skipped because their resource isn't on this Pod. */
  skipped: number;
}

/**
 * Rebuild the WAC `.acl` enforcement state from the `shared-out/` event log: fold
 * the log to its currently-active grants and re-apply each one's ACL (no inbox
 * post, no log append — the log entry already exists). This treats the log as the
 * ground truth and the `.acl` as a derived projection, so it reconstructs sharing
 * after an archive restore (which captures the log but not the `.acl` files) and
 * doubles as a repair for ACL drift.
 *
 * **Same-Pod only:** the log records absolute resource IRIs. Grants whose resource
 * doesn't live under this session's storage root are skipped (a cross-Pod restore
 * would need the IRIs rewritten first). Recipient-side state (their inbox /
 * `shared-in/`) is on the recipient's Pod and is intentionally untouched.
 */
export async function reissueGrants(session: Session): Promise<ReissueResult> {
  const webId = session.info.webId;
  if (!session.info.isLoggedIn || !webId) {
    throw new Error("User is not logged in");
  }
  const root = getStorageRoot(webId);
  const grants = await foldSharingLog(sharedOutUrl(webId), session);

  const result: ReissueResult = { buildings: 0, views: 0, skipped: 0 };
  for (const g of grants) {
    const resourceFile = g.resource.split("#")[0];
    // Only replay grants for resources that live on this Pod.
    if (!resourceFile.startsWith(root)) {
      result.skipped++;
      continue;
    }
    if (g.kind === "View") {
      await grantReadAccess(resourceFile, g.grantee, session);
      result.views++;
    } else {
      // Default to Building (kind is a routing hint; a missing kind is legacy).
      await applyBuildingGrant(resourceFile, g.grantee, session, {
        includeEnergyData: g.includesEnergy ?? true,
        years: g.years,
      });
      result.buildings++;
    }
  }
  return result;
}

async function postToInbox(
  buildingUri: string,
  webId: string,
  session: Session,
  options: ShareOptions,
) {
  const inboxUrl = await getRecipientInboxUrl(webId, session);

  // The inbox message IS a sharing event (the recipient archives it into their
  // shared-in/ log on readInbox) — same shape as shared-out/.
  const message = buildSharingEventTurtle({
    type: "grant",
    owner: session.info.webId!,
    grantee: webId,
    resource: buildingUri,
    kind: "Building",
    includesEnergy: options.includeEnergyData,
    at: new Date().toISOString(),
  });

  const postResponse = await session.fetch(inboxUrl, {
    method: "POST",
    headers: { "Content-Type": "text/turtle" },
    body: message,
  });

  if (!postResponse.ok) {
    throw new Error(
      `Failed to post message to inbox at ${inboxUrl}: ${postResponse.statusText}`,
    );
  }
}

/**
 * The energy resources to grant access to when sharing a building: each
 * `gran:EnergyDataset` resource (annual `.ttl` or series descriptor), plus — for
 * a series — its daily-files container (granted with `acl:default`, covering the
 * files inside). Derived from the building's `gran:hasEnergyDataset` link slugs.
 *
 * When `years` is given, only datasets for those years are returned (per-year
 * sharing); absent ⇒ all years.
 */
export async function getEnergyDataUrls(
  buildingUri: string,
  session: Session,
  years?: number[],
): Promise<Array<{ url: string; isContainer: boolean }>> {
  const buildingResponse = await session.fetch(buildingUri, { method: "GET" });
  if (!buildingResponse.ok) {
    throw new Error(
      `Failed to fetch building data at ${buildingUri}: ${buildingResponse.statusText}`,
    );
  }
  const store = new Store(
    new Parser({ baseIRI: buildingUri }).parse(await buildingResponse.text()),
  );

  const targets: Array<{ url: string; isContainer: boolean }> = [];
  for (
    const link of store.getObjects(
      null,
      DataFactory.namedNode(`${GRAN_NS}hasEnergyDataset`),
      null,
    )
  ) {
    const ref = parseDatasetSlug(link.value);
    if (!ref) continue;
    if (years && !years.includes(ref.year)) continue;
    const file = link.value.split("#")[0];
    targets.push({ url: file, isContainer: false });
    if (isSeriesGranularity(ref.granularity)) {
      targets.push({ url: file.replace(/\.ttl$/, "/"), isContainer: true });
    }
  }
  return targets;
}

/** The building's energy-certificate file URL (`gran:hasEnergyCertificate`), or null. */
export async function getEnergyCertificateUrl(
  buildingFileUri: string,
  session: Session,
): Promise<string | null> {
  const res = await session.fetch(buildingFileUri, { method: "GET" });
  if (!res.ok) return null;
  const store = new Store(
    new Parser({ baseIRI: buildingFileUri }).parse(await res.text()),
  );
  const obj = store.getObjects(
    null,
    DataFactory.namedNode(GRAN_HAS_ENERGY_CERTIFICATE),
    null,
  )[0];
  return obj ? obj.value : null;
}

/**
 * Grant read access to a resource (or container, with acl:default) for a WebID —
 * idempotently and without clobbering a concurrent edit.
 *
 * Routed through {@link readModifyWrite} (GET → parse to a Store → mutate →
 * conditional PUT), which fixes the previous GET-text + string-concat + blind PUT:
 * - two concurrent grants (or a grant racing a revoke) no longer last-PUT-wins
 *   each other — the `If-Match`/retry loop serializes them;
 * - re-granting the same WebID *replaces* its single `#Read_<webid>` authorization
 *   instead of appending a duplicate block.
 *
 * When the resource has no ACL yet (404), the owner's full-control authorization
 * is (re-)established first — otherwise the grant would write an ACL that locks
 * the owner out of their own resource.
 *
 * Exported for unit testing (the public `shareBuildingData` reaches it).
 */
export async function grantReadAccess(
  resourceUri: string,
  webId: string,
  session: Session,
  isContainer = false,
): Promise<void> {
  if (!session.info.isLoggedIn) {
    throw new Error("User is not logged in");
  }
  const aclUrl = `${resourceUri}.acl`;
  const ownerWebId = session.info.webId as string;
  const authLabel = `Read_${webId.replace(/[^a-zA-Z0-9]/g, "_")}`;
  try {
    await readModifyWrite(aclUrl, session, (store, { created }) => {
      if (created) {
        writeAuthorization(store, aclUrl, "ControlReadWrite", ownerWebId, {
          resourceUri,
          isContainer,
          modes: ["Read", "Write", "Control"],
        });
      }
      writeAuthorization(store, aclUrl, authLabel, webId, {
        resourceUri,
        isContainer,
        modes: ["Read"],
      });
    });
  } catch (error) {
    throw new Error(
      `Failed to update ACL for ${resourceUri}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * Write a single WAC authorization (subject `<aclUrl>#<label>`) into the store,
 * first removing any prior triples for that subject so repeated writes are
 * idempotent (no duplicate or stale modes). `modes` are local ACL mode names
 * (`Read`/`Write`/`Control`), expanded against `ACL_NS`.
 */
function writeAuthorization(
  store: Store,
  aclUrl: string,
  label: string,
  agentWebId: string,
  opts: { resourceUri: string; isContainer: boolean; modes: string[] },
): void {
  const subject = DataFactory.namedNode(`${aclUrl}#${label}`);
  for (const q of store.getQuads(subject, null, null, null)) store.removeQuad(q);
  const add = (p: string, o: string) =>
    store.addQuad(subject, DataFactory.namedNode(p), DataFactory.namedNode(o));
  add(RDF_TYPE, `${ACL_NS}Authorization`);
  add(`${ACL_NS}agent`, agentWebId);
  add(`${ACL_NS}accessTo`, opts.resourceUri);
  if (opts.isContainer) add(`${ACL_NS}default`, opts.resourceUri);
  for (const mode of opts.modes) add(`${ACL_NS}mode`, `${ACL_NS}${mode}`);
}

/**
 * Share an aggregated view snapshot with another user
 * Only the computed snapshot is shared (not the view definition with building URIs)
 */
export async function shareAggregatedView(
  snapshotUrl: string,
  webId: string,
  session: Session,
): Promise<void> {
  if (!session.info.isLoggedIn) {
    throw new Error("User is not logged in");
  }

  console.log(`Sharing aggregated view ${snapshotUrl} with WebID ${webId}`);

  // Share the snapshot resource (sets ACL)
  await grantReadAccess(snapshotUrl, webId, session);

  // Notify the recipient (the message is a sharing event with gran:kind View) and
  // record the outgoing share in shared-out/. The viewId is recoverable from the
  // snapshot URL (`views/snapshots/<viewId>.ttl`), so it isn't carried separately.
  await postViewGrantToInbox(snapshotUrl, webId, session);
  await recordViewSharing(snapshotUrl, webId, session);
}

/** Post an aggregated-view access grant (the shared-event shape) to the inbox. */
async function postViewGrantToInbox(
  snapshotUrl: string,
  webId: string,
  session: Session,
): Promise<void> {
  const inboxUrl = await getRecipientInboxUrl(webId, session);

  const message = buildSharingEventTurtle({
    type: "grant",
    owner: session.info.webId!,
    grantee: webId,
    resource: snapshotUrl,
    kind: "View",
    at: new Date().toISOString(),
  });

  const postResponse = await session.fetch(inboxUrl, {
    method: "POST",
    headers: { "Content-Type": "text/turtle" },
    body: message,
  });

  if (!postResponse.ok) {
    throw new Error(
      `Failed to post view grant message to inbox at ${inboxUrl}: ${postResponse.statusText}`,
    );
  }
}
