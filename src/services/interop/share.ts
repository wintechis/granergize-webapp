import { Session } from "@inrupt/solid-client-authn-browser";
import { DataFactory, Parser, Store } from "n3";
import {
  getSubresourceAclTargets,
  recordSharing,
  recordViewSharing,
  removeFromACL,
} from "./sharingManager.ts";
import { postSharingEventToInbox } from "./inbox.ts";
import {
  foldSharingLogEvents,
  sharedOutUrl,
} from "./sharingLog.ts";
import {
  ACL_NS,
  GRAN_HAS_ENERGY_CERTIFICATE,
  CONSUMPTION_NS,
  RDF_TYPE,
} from "../rdf/vocabularies.ts";
import { parseDatasetSlug } from "../rdf/energyDataset.ts";
import { mintLocalIri } from "../rdf/rdfHelpers.ts";
import { isSeriesGranularity } from "../rdf/durationUtils.ts";
import { ensureContainer, readModifyWrite } from "../pod/podWrite.ts";
import { fetchFresh, readStoreOrEmpty } from "../pod/podFetch.ts";
import { filesContainerFor } from "../attachmentManager.ts";
import { getStorageRoot } from "../pod/solidUtils.ts";
import { mapPooled } from "../../lib/pool.ts";

export interface ShareOptions {
  includeEnergyData: boolean;
  /** Restrict the energy grant to these years only. Absent = all years (today's behavior). */
  years?: number[];
}

/**
 * Share a building with a recipient: apply the WAC grants, notify their inbox, and
 * record the outgoing share in the `shared-out/` log.
 * @operation mutation
 */
export async function shareBuildingData(
  buildingUri: string,
  webId: string,
  session: Session,
  options: ShareOptions = { includeEnergyData: true },
) {
  const buildingFile = buildingUri.split("#")[0];

  // Order matters: the shared-out/ log is the GROUND TRUTH of sharing, so the
  // grant event is appended FIRST. A failure after the append leaves an
  // event-without-ACL, which is exactly the drift reissueGrants repairs; the
  // reverse order risked an ACL-without-event — live access the log doesn't
  // know about, invisible to revoke-all-before-delete and to replay.
  // (revokeAccess follows the same log-first rule.)
  await recordSharing(
    buildingFile,
    webId,
    session,
    options.includeEnergyData,
    options.years,
  );

  // Write the WAC grants (the enforcement side — a derived projection).
  await applyBuildingGrant(buildingFile, webId, session, options);

  // Notify the recipient (inbox) last, once enforcement is in place. The inbox
  // post and the log append are the *record/notify* side and are deliberately
  // NOT part of applyBuildingGrant, so a log replay (reissueGrants) can
  // re-apply ACLs without re-notifying or re-appending to the log.
  await postToInbox(buildingFile, webId, session, options);
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
 * included — each `cons:EnergyDataset` (restricted to `options.years` if given)
 * plus a series' daily-files container.
 * @operation mutation
 */
export async function applyBuildingGrant(
  buildingFile: string,
  webId: string,
  session: Session,
  options: ShareOptions = { includeEnergyData: true },
): Promise<void> {
  // Provision the per-building files/ container first so its acl:default grant
  // has something to attach to (attachments + the energy certificate; one
  // default covers every file in it — including uploads added after this share).
  const filesContainer = filesContainerFor(buildingFile);
  await ensureContainer(filesContainer.replace(/files\/$/, ""), session);
  await ensureContainer(filesContainer, session);

  // The target set comes from the ONE enumeration shared with auditGrants
  // (buildingGrantTargets), so the applied projection and the audited
  // expectation cannot disagree about what a grant covers.
  // Each target has its OWN .acl, so the grants are independent and can run
  // concurrently (bounded, like every other Pod fan-out). Error semantics: the
  // first rejection propagates out of mapPooled (a failed grant must surface to
  // the caller); the surviving workers may still attempt the remaining grants,
  // which is fine here — each grant is an idempotent projection of the
  // already-appended log event, so any extra successes only reduce log↔ACL
  // drift (reissueGrants would re-apply exactly those grants anyway).
  const targets = await buildingGrantTargets(buildingFile, session, options);
  await mapPooled(
    targets,
    4,
    (t) => grantReadAccess(t.url, webId, session, t.isContainer),
  );
}

/** One resource a grant's ACL projection covers. */
export interface GrantTarget {
  url: string;
  /** Granted with `acl:default` (a container whose members inherit). */
  isContainer: boolean;
}

/**
 * Every resource a building grant covers — the *expected* ACL projection of one
 * folded `shared-out/` grant event: the building file, its `files/` container
 * (acl:default), a legacy certificate outside `files/`, and — when energy is
 * included — each `cons:EnergyDataset` (restricted to `options.years` if given)
 * plus a series' daily-files container. Deduped by URL.
 *
 * This is the single source of "what a grant covers": {@link applyBuildingGrant}
 * writes exactly this set and {@link auditGrants} diffs against exactly this
 * set, so apply and audit cannot drift apart. Pure read — no provisioning.
 * @operation query
 */
export async function buildingGrantTargets(
  buildingFile: string,
  session: Session,
  options: ShareOptions = { includeEnergyData: true },
): Promise<GrantTarget[]> {
  const filesContainer = filesContainerFor(buildingFile);
  const targets: GrantTarget[] = [
    { url: buildingFile, isContainer: false },
    { url: filesContainer, isContainer: true },
  ];

  // A legacy energy certificate stored OUTSIDE files/ (the old shared
  // certificates/ folder) isn't covered by the container grant — the file
  // itself is a target so existing shares keep working without a re-upload.
  const certUrl = await getEnergyCertificateUrl(buildingFile, session);
  if (certUrl && !certUrl.startsWith(filesContainer)) {
    targets.push({ url: certUrl, isContainer: false });
  }

  if (options.includeEnergyData) {
    targets.push(...await getEnergyDataUrls(buildingFile, session, options.years));
  }

  // Dedup: two dataset links into the same file must not yield one target twice
  // (a doubled grant would race one read-modify-write against itself).
  const seen = new Set<string>();
  return targets.filter((t) => !seen.has(t.url) && !!seen.add(t.url));
}

export interface ReissueResult {
  /** Active building grants re-applied. */
  buildings: number;
  /** Active view grants re-applied. */
  views: number;
  /** Active grants skipped because their resource isn't on this Pod. */
  skipped: number;
  /** Active grants skipped because their resource no longer exists (deleted). */
  missing: number;
  /** Revoked pairs whose ACL withdrawal was (re-)applied. */
  revoked: number;
}

/**
 * Rebuild the WAC `.acl` enforcement state from the `shared-out/` event log: fold
 * the log to the latest event per (grantee, resource) pair and replay it — a
 * grant re-applies the ACL, a revocation withdraws it (no inbox post, no log
 * append — the log entries already exist). This treats the log as the ground
 * truth and the `.acl` as a derived projection, so it reconstructs sharing after
 * an archive restore (which captures the log but not the `.acl` files) and
 * repairs drift in BOTH directions: an event-without-ACL (e.g. a share whose ACL
 * write failed) is re-granted, and a revoked-in-log-but-still-granted ACL (a
 * revoke whose ACL write failed) is withdrawn. It does NOT touch agents that
 * never appear in the log (an `.acl` edited out-of-band stays as-is).
 *
 * A grant whose resource no longer exists (a deleted building whose
 * pre-delete revoke pass failed) is counted `missing` and skipped — re-applying
 * it would resurrect empty containers and orphan `.acl` files.
 *
 * **Same-Pod only:** the log records absolute resource IRIs. Events whose
 * resource doesn't live under this session's storage root are skipped (a
 * cross-Pod restore would need the IRIs rewritten first). Recipient-side state
 * (their inbox / `shared-in/`) is on the recipient's Pod and is intentionally
 * untouched.
 * @operation mutation
 */
export async function reissueGrants(session: Session): Promise<ReissueResult> {
  const webId = session.info.webId;
  if (!session.info.isLoggedIn || !webId) {
    throw new Error("User is not logged in");
  }
  const root = getStorageRoot(webId);
  const events = await foldSharingLogEvents(sharedOutUrl(webId), session);

  const result: ReissueResult = {
    buildings: 0,
    views: 0,
    skipped: 0,
    missing: 0,
    revoked: 0,
  };
  for (const e of events) {
    const resourceFile = e.resource.split("#")[0];
    // Only replay events for resources that live on this Pod.
    if (!resourceFile.startsWith(root)) {
      result.skipped++;
      continue;
    }

    if (e.type === "revocation") {
      // Withdraw enforcement the log says is gone. removeFromACL is idempotent
      // (and owner-lockout-safe), so replaying an already-withdrawn pair is a
      // no-op; sub-resources of a since-deleted building simply aren't there.
      await removeFromACL(resourceFile, e.grantee, session);
      try {
        for (const t of await getSubresourceAclTargets(resourceFile, session)) {
          await removeFromACL(t, e.grantee, session);
        }
      } catch {
        // The resource is gone — nothing underneath to withdraw.
      }
      result.revoked++;
      continue;
    }

    // A grant for a deleted resource must not be re-applied (it would recreate
    // empty containers + orphan .acls). HEAD distinguishes deleted from present.
    const head = await session.fetch(resourceFile, { method: "HEAD" });
    if (head.status === 404 || head.status === 410) {
      result.missing++;
      continue;
    }

    if (e.kind === "View") {
      await grantReadAccess(resourceFile, e.grantee, session);
      result.views++;
    } else {
      // Default to Building (kind is a routing hint; a missing kind is legacy).
      await applyBuildingGrant(resourceFile, e.grantee, session, {
        includeEnergyData: e.includesEnergy ?? true,
        years: e.years,
      });
      result.buildings++;
    }
  }
  return result;
}

/**
 * Reconciliation (the Model-3 projection update for a grown scope): after a
 * building's dataset set changes — a new energy year — re-apply the ACL
 * projection of every ACTIVE grant on that building, so a grant recorded with
 * an *intensional* scope ("all energy years") extends to the dataset that now
 * exists. The recorded scope is honoured exactly: an all-years grant (no
 * recorded years) picks up the new dataset via {@link buildingGrantTargets}'
 * re-enumeration; a per-year grant re-applies only its recorded years, so the
 * new year correctly stays outside it. Record-free like {@link reissueGrants}
 * (no log append, no inbox post — the logged event already covers the scope,
 * so replayability is untouched) and idempotent (re-applying an intact grant
 * is a no-op). Returns the number of grants re-applied; an unshared building
 * folds to zero matching events and writes nothing.
 *
 * Called from the write-energy-year mutation path (a *reconciliation*-triggered
 * mutation living inside a user-intent one — see
 * `notes/read-write-operations.md` §trigger); best-effort there, since the
 * year is already saved when it runs — drift from a failed reconciliation is
 * exactly what {@link auditGrants} detects and {@link reissueGrants} repairs.
 * @operation mutation
 */
export async function reconcileBuildingGrants(
  buildingFile: string,
  session: Session,
): Promise<number> {
  const webId = session.info.webId;
  if (!session.info.isLoggedIn || !webId) {
    throw new Error("User is not logged in");
  }
  const events = await foldSharingLogEvents(sharedOutUrl(webId), session);
  const active = events.filter((e) =>
    e.type !== "revocation" &&
    e.kind !== "View" &&
    e.resource.split("#")[0] === buildingFile
  );
  for (const e of active) {
    await applyBuildingGrant(buildingFile, e.grantee, session, {
      includeEnergyData: e.includesEnergy ?? true,
      years: e.years,
    });
  }
  return active.length;
}

/** One disagreement between the `shared-out/` log and an actual `.acl`. */
export interface GrantDrift {
  /** `missing-grant`: the log says the grantee may read it, the `.acl` doesn't.
   *  `lingering-grant`: the log's latest event is a revocation, the `.acl` still grants. */
  kind: "missing-grant" | "lingering-grant";
  grantee: string;
  /** The specific resource whose `.acl` disagrees (not the whole building). */
  resource: string;
}

export interface GrantAuditResult {
  /** (grantee, resource) pairs compared. */
  checked: number;
  /** Empty ⇔ the ACL projection matches the folded log. */
  drift: GrantDrift[];
  /** Events whose resource isn't on this Pod — not auditable from this session. */
  skipped: number;
  /** Active grants whose resource no longer exists (deleted) — not drift; replay skips them too. */
  missing: number;
}

/**
 * Dry-run twin of {@link reissueGrants}: fold the `shared-out/` log to the latest
 * event per (grantee, resource) pair, compute the *expected* ACL projection — the
 * same enumeration the repair would write ({@link buildingGrantTargets}, against
 * the building's CURRENT datasets) — read the actual `.acl`s, and report the
 * diff. **No writes**: this makes log↔ACL drift observable without touching the
 * Pod, so it serves as a pre-repair audit ("is a rebuild needed?"), a post-repair
 * verification (re-run, expect empty), and the field-side form of the Tier-2
 * `grant-projection` invariant: a grantee can read exactly what the folded log
 * says.
 *
 * Both drift directions are reported: a `missing-grant` (a share whose ACL write
 * failed, or a dataset written AFTER an all-years share — the known
 * `writeEnergyYear` gap, see QUESTIONS.md) and a `lingering-grant` (a revocation
 * whose ACL withdrawal failed). Same scope rules as the repair: off-Pod events
 * are skipped, deleted resources counted `missing`, out-of-band agents (in an
 * `.acl` but never in the log) are not reported, and a self-grantee revocation
 * is not flagged (`removeFromACL` never withdraws the owner). Advisory by
 * nature: `readStoreOrEmpty` degrades a transient error to an empty store, so a
 * throttled `.acl` read can show up as a spurious `missing-grant` — re-run
 * before acting on one.
 * @operation query
 */
export async function auditGrants(session: Session): Promise<GrantAuditResult> {
  const webId = session.info.webId;
  if (!session.info.isLoggedIn || !webId) {
    throw new Error("User is not logged in");
  }
  const root = getStorageRoot(webId);
  const events = await foldSharingLogEvents(sharedOutUrl(webId), session);

  const result: GrantAuditResult = {
    checked: 0,
    drift: [],
    skipped: 0,
    missing: 0,
  };
  for (const e of events) {
    const resourceFile = e.resource.split("#")[0];
    if (!resourceFile.startsWith(root)) {
      result.skipped++;
      continue;
    }

    if (e.type === "revocation") {
      // The repair never withdraws the owner's own access (removeFromACL's
      // lockout guard), so a self-grantee revocation can't be drift.
      if (e.grantee === webId) continue;
      let targets = [resourceFile];
      try {
        targets = [
          ...new Set([
            resourceFile,
            ...await getSubresourceAclTargets(resourceFile, session),
          ]),
        ];
      } catch {
        // The resource is gone — only the file-level ACL could linger.
      }
      for (const t of targets) {
        result.checked++;
        if (await hasReadGrant(t, e.grantee, session)) {
          result.drift.push({
            kind: "lingering-grant",
            grantee: e.grantee,
            resource: t,
          });
        }
      }
      continue;
    }

    // Same rule as the repair: a grant for a deleted resource is not drift.
    const head = await session.fetch(resourceFile, { method: "HEAD" });
    if (head.status === 404 || head.status === 410) {
      result.missing++;
      continue;
    }

    const targets: GrantTarget[] = e.kind === "View"
      ? [{ url: resourceFile, isContainer: false }]
      : await buildingGrantTargets(resourceFile, session, {
        includeEnergyData: e.includesEnergy ?? true,
        years: e.years,
      });
    for (const t of targets) {
      result.checked++;
      if (!(await hasReadGrant(t.url, e.grantee, session, t.isContainer))) {
        result.drift.push({
          kind: "missing-grant",
          grantee: e.grantee,
          resource: t.url,
        });
      }
    }
  }
  return result;
}

/**
 * Does the resource's own `.acl` hold an authorization granting `webId`
 * `acl:Read` on it (with `acl:default` too when the target is a container)?
 * The read-side mirror of {@link writeAuthorization}'s shape. An absent or
 * unreadable `.acl` reads as "no grant".
 */
async function hasReadGrant(
  resourceUri: string,
  webId: string,
  session: Session,
  isContainer = false,
): Promise<boolean> {
  const { namedNode } = DataFactory;
  const store = await readStoreOrEmpty(`${resourceUri}.acl`, session);
  return store
    .getQuads(null, namedNode(`${ACL_NS}agent`), namedNode(webId), null)
    .some(({ subject: s }) =>
      store.getQuads(s, namedNode(`${ACL_NS}accessTo`), namedNode(resourceUri), null)
          .length > 0 &&
      store.getQuads(s, namedNode(`${ACL_NS}mode`), namedNode(`${ACL_NS}Read`), null)
          .length > 0 &&
      (!isContainer ||
        store.getQuads(s, namedNode(`${ACL_NS}default`), namedNode(resourceUri), null)
            .length > 0)
    );
}

async function postToInbox(
  buildingUri: string,
  webId: string,
  session: Session,
  options: ShareOptions,
) {
  // The inbox message IS a sharing event (the recipient archives it into their
  // shared-in/ log on drainInbox) — same shape as shared-out/, carrying EVERY
  // share dimension (incl. per-year scope) so the recipient's record is as
  // self-sufficient as the owner's.
  await postSharingEventToInbox(webId, session, {
    type: "grant",
    owner: session.info.webId!,
    grantee: webId,
    resource: buildingUri,
    kind: "Building",
    includesEnergy: options.includeEnergyData,
    ...(options.years ? { years: options.years } : {}),
    at: new Date().toISOString(),
  });
}

/**
 * The energy resources to grant access to when sharing a building: each
 * `cons:EnergyDataset` resource (annual `.ttl` or series descriptor), plus — for
 * a series — its daily-files container (granted with `acl:default`, covering the
 * files inside). Derived from the building's `cons:hasEnergyDataset` link slugs.
 *
 * When `years` is given, only datasets for those years are returned (per-year
 * sharing); absent ⇒ all years.
 * @operation query
 */
export async function getEnergyDataUrls(
  buildingUri: string,
  session: Session,
  years?: number[],
): Promise<Array<{ url: string; isContainer: boolean }>> {
  const buildingResponse = await fetchFresh(buildingUri, session);
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
      DataFactory.namedNode(`${CONSUMPTION_NS}hasEnergyDataset`),
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
 * The building's energy-certificate file URL (`bldg:hasEnergyCertificate`), or null.
 * @operation query
 */
export async function getEnergyCertificateUrl(
  buildingFileUri: string,
  session: Session,
): Promise<string | null> {
  const store = await readStoreOrEmpty(buildingFileUri, session);
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
 * @operation mutation
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
  for (const mode of opts.modes) {
    add(`${ACL_NS}mode`, mintLocalIri(ACL_NS, mode).value);
  }
}

/**
 * Share an aggregated view snapshot with another user
 * Only the computed snapshot is shared (not the view definition with building URIs)
 * @operation mutation
 */
export async function shareAggregatedView(
  snapshotUrl: string,
  webId: string,
  session: Session,
): Promise<void> {
  if (!session.info.isLoggedIn) {
    throw new Error("User is not logged in");
  }

  // Log first (ground truth), then enforcement, then notify — the same ordering
  // rationale as shareBuildingData. The viewId is recoverable from the snapshot
  // URL (`views/snapshots/<viewId>.ttl`), so it isn't carried separately.
  await recordViewSharing(snapshotUrl, webId, session);
  await grantReadAccess(snapshotUrl, webId, session);
  await postViewGrantToInbox(snapshotUrl, webId, session);
}

/** Post an aggregated-view access grant (the shared-event shape) to the inbox. */
async function postViewGrantToInbox(
  snapshotUrl: string,
  webId: string,
  session: Session,
): Promise<void> {
  await postSharingEventToInbox(webId, session, {
    type: "grant",
    owner: session.info.webId!,
    grantee: webId,
    resource: snapshotUrl,
    kind: "View",
    at: new Date().toISOString(),
  });
}
