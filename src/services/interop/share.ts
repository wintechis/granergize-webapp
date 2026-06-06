import { Session } from "@inrupt/solid-client-authn-browser";
import { DataFactory, Parser, Store } from "n3";
import { recordSharing, recordViewSharing } from "./sharingManager.ts";
import { getRecipientInboxUrl } from "./inbox.ts";
import { buildSharingEventTurtle } from "./sharingLog.ts";
import { ACL_NS, GRAN_NS, RDF_TYPE } from "../utils/vocabularies.ts";
import { parseDatasetSlug } from "../utils/energyDataset.ts";
import { isSeriesGranularity } from "../utils/durationUtils.ts";
import { readModifyWrite } from "../utils/podWrite.ts";

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
  // Always share the building's static data
  await grantReadAccess(buildingUri.split("#")[0], webId, session);

  // Conditionally share energy data: grant access to each gran:EnergyDataset
  // resource (annual file / series descriptor), plus a series' daily-files
  // container (with acl:default, so the files inside are covered).
  if (options.includeEnergyData) {
    for (
      const t of await getEnergyDataUrls(
        buildingUri.split("#")[0],
        session,
        options.years,
      )
    ) {
      await grantReadAccess(t.url, webId, session, t.isContainer);
    }
  }

  await postToInbox(buildingUri.split("#")[0], webId, session, options);

  // Record the outgoing share in our append-only shared-out/ log.
  await recordSharing(
    buildingUri.split("#")[0],
    webId,
    session,
    options.includeEnergyData,
  );
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
