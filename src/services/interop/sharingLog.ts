import type { PodGateway } from "../pod/podGateway.ts";
import { listLogEvents, readEventCached } from "../pod/eventLog.ts";
import { DataFactory, Store } from "n3";
import {
  ACL_NS,
  CONSUMPTION_NS,
  GRAN_NS,
  INTEROP_NS,
  PROV_GENERATED_AT_TIME,
  PROV_NS,
  PROV_WAS_ASSOCIATED_WITH,
  RDF_TYPE,
  REC_BUILDING,
  XSD_NS,
} from "../rdf/vocabularies.ts";
import { podResources } from "../pod/solidUtils.ts";
import { readStoreOrAbsent } from "../pod/podFetch.ts";
import { appendToContainer, ensureContainer } from "../pod/podWrite.ts";
import { mapPooled } from "../../lib/pool.ts";
import { getAppQueryClient } from "../../lib/appQueryClient.ts";
import { queryKeys } from "../../lib/queryKeys.ts";

const { namedNode } = DataFactory;

/**
 * The sharing event logs. Two symmetric, append-only LDP containers under
 * `granergize/`, one event resource each (POST → the server mints the child IRI,
 * so concurrent appends never clobber). One Turtle shape serves all three places
 * a sharing event appears — the recipient's inbox message, the sharer's
 * `shared-out/`, and the recipient's `shared-in/`:
 *
 *   <> a interop:AccessGrant ;
 *      prov:wasAssociatedWith <sharer-webid> ;   # the owner who shared
 *      interop:grantee        <recipient-webid> ;
 *      interop:forResource    <resource-uri> ;
 *      interop:accessMode     acl:Read ;
 *      gran:kind              rec:Building ;      # the shared resource's class:
 *      prov:generatedAtTime   "…"^^xsd:dateTime . # rec:Building | cons:Aggregation
 *
 * A revocation is `a interop:AccessRevocation` with the same (grantee, resource)
 * and a later time, and no accessMode/kind. Current state = fold the log: group
 * by (grantee, resource), take the latest event; the pair is active iff that
 * latest event is a grant. The WAC `.acl` stays the enforcement truth — these
 * logs are the app's *record* (history) and the only way a recipient learns of an
 * inbound grant (it lives in the sharer's `.acl`, reachable only via the inbox).
 */
export type SharingKind = "Building" | "Aggregation";

export interface SharingEvent {
  type: "grant" | "revocation";
  owner: string; // the sharer (prov:wasAssociatedWith)
  grantee: string; // the recipient (interop:grantee)
  resource: string; // interop:forResource
  at: string; // prov:generatedAtTime (ISO 8601)
  kind?: SharingKind; // the resource's class (routing hint; on grants AND revocations)
  includesEnergy?: boolean; // grant hint only
  /**
   * The granted energy years (grant only). Absent/empty ⇒ all years (the
   * `includesEnergy` boolean alone governs). Recorded so the log is self-sufficient
   * for replay (`reissueGrants`) — a per-year grant's exact scope lives here, not
   * only in the derived `.acl`. See the "always replayable" sharing principle.
   */
  years?: number[];
  /**
   * The granted attachment file IRIs (grant only). Absent/empty ⇒ all attachments
   * (the `files/` container is granted with `acl:default`, covering current AND
   * future uploads). A subset names exactly the included files; each is granted
   * individually and the `files/` container default is withheld, so the unselected
   * binaries stay unreadable. Recorded so the log is self-sufficient for replay
   * (`reissueGrants`) — the exact attachment scope lives here, not only in the
   * derived `.acl`. Mirrors {@link SharingEvent.years}.
   */
  attachmentUris?: string[];
}

/** A currently-active grant: the latest event for its (grantee, resource). */
export type ActiveGrant = Omit<SharingEvent, "type">;

/** `granergize/shared-in/` — sharing received (folded for "shared with me"). */
export function sharedInUri(webId: string): string {
  return podResources(webId).sharedIn;
}

/** `granergize/shared-out/` — sharing performed (history + "shared with" badge). */
export function sharedOutUri(webId: string): string {
  return podResources(webId).sharedOut;
}

const A = namedNode(RDF_TYPE);
const GRANT = namedNode(`${INTEROP_NS}AccessGrant`);
const REVOCATION = namedNode(`${INTEROP_NS}AccessRevocation`);
const GRANTEE = namedNode(`${INTEROP_NS}grantee`);
const FOR_RESOURCE = namedNode(`${INTEROP_NS}forResource`);
const INCLUDES_ENERGY = namedNode(`${INTEROP_NS}includesEnergyData`);
const INCLUDES_ENERGY_YEAR = namedNode(`${INTEROP_NS}includesEnergyYear`);
const INCLUDES_ATTACHMENT = namedNode(`${INTEROP_NS}includesAttachment`);
const WAS_ASSOCIATED_WITH = namedNode(PROV_WAS_ASSOCIATED_WITH);
const GENERATED_AT = namedNode(PROV_GENERATED_AT_TIME);
const KIND = namedNode(`${GRAN_NS}kind`);

/** Sharing kind ↔ the shared resource's class IRI (the `gran:kind` value). */
const KIND_TO_IRI: Record<SharingKind, string> = {
  Building: REC_BUILDING,
  Aggregation: `${CONSUMPTION_NS}Aggregation`,
};

/** Serialize one event resource (subject `<>` — the resource *is* the event). */
export function buildSharingEventTurtle(e: SharingEvent): string {
  const triples = [
    `a interop:${e.type === "grant" ? "AccessGrant" : "AccessRevocation"}`,
    `prov:wasAssociatedWith <${e.owner}>`,
    `interop:grantee <${e.grantee}>`,
    `interop:forResource <${e.resource}>`,
  ];
  // Every dimension lives IN the event — kind included, for revocations too,
  // so the log replay (reissueGrants/auditGrants) can dispatch a revocation
  // without guessing the resource's class.
  if (e.kind) triples.push(`gran:kind <${KIND_TO_IRI[e.kind]}>`);
  if (e.type === "grant") {
    triples.push("interop:accessMode acl:Read");
    if (e.includesEnergy !== undefined) {
      triples.push(`interop:includesEnergyData "${e.includesEnergy}"^^xsd:boolean`);
    }
    // Per-year scope (absent ⇒ all years). One triple per granted year so the
    // log fully captures a per-year share for faithful replay.
    for (const year of e.years ?? []) {
      triples.push(`interop:includesEnergyYear "${year}"^^xsd:gYear`);
    }
    // Per-attachment scope (absent ⇒ all attachments via the files/ container
    // default). One IRI triple per included file so the log fully captures a
    // per-attachment share for faithful replay.
    for (const uri of e.attachmentUris ?? []) {
      triples.push(`interop:includesAttachment <${uri}>`);
    }
  }
  triples.push(`prov:generatedAtTime "${e.at}"^^xsd:dateTime`);
  return [
    `@prefix interop: <${INTEROP_NS}> .`,
    `@prefix prov: <${PROV_NS}> .`,
    `@prefix acl: <${ACL_NS}> .`,
    `@prefix gran: <${GRAN_NS}> .`,
    `@prefix xsd: <${XSD_NS}> .`,
    "",
    `<> ${triples.join(" ;\n   ")} .`,
    "",
  ].join("\n");
}

/**
 * Append one event to a log container (POST — never rewrites an existing event).
 * @operation mutation
 */
export async function appendSharingEvent(
  containerUri: string,
  gateway: PodGateway,
  event: SharingEvent,
): Promise<void> {
  // Announce: a first event lazily provisions shared-out//shared-in/, a creation
  // the user wouldn't otherwise see.
  await ensureContainer(containerUri, gateway, { announce: true });
  await appendToContainer(containerUri, buildSharingEventTurtle(event), gateway, {
    describeError: (res) => `Failed to append sharing event (HTTP ${res.status})`,
  });
}

/** Extract every grant/revocation event from one parsed event resource. */
export function parseSharingEvents(store: Store): SharingEvent[] {
  const out: SharingEvent[] = [];
  const collect = (
    type: SharingEvent["type"],
    typeNode: typeof GRANT | typeof REVOCATION,
  ) => {
    for (const subj of store.getSubjects(A, typeNode, null)) {
      const grantee = store.getObjects(subj, GRANTEE, null)[0]?.value;
      const resource = store.getObjects(subj, FOR_RESOURCE, null)[0]?.value;
      const at = store.getObjects(subj, GENERATED_AT, null)[0]?.value;
      if (!grantee || !resource || !at) continue;
      const owner = store.getObjects(subj, WAS_ASSOCIATED_WITH, null)[0]?.value ??
        "";
      const kindIri = store.getObjects(subj, KIND, null)[0]?.value;
      const kind: SharingKind | undefined = kindIri === KIND_TO_IRI.Aggregation
        ? "Aggregation"
        : kindIri === KIND_TO_IRI.Building
        ? "Building"
        : undefined;
      const energy = store.getObjects(subj, INCLUDES_ENERGY, null)[0]?.value;
      const years = store.getObjects(subj, INCLUDES_ENERGY_YEAR, null)
        .map((o) => parseInt(o.value, 10))
        .filter((y) => Number.isFinite(y))
        .sort((a, b) => a - b);
      const attachmentUris = store.getObjects(subj, INCLUDES_ATTACHMENT, null)
        .map((o) => o.value)
        .sort();
      const event: SharingEvent = {
        type,
        owner,
        grantee,
        resource,
        at,
        kind,
        includesEnergy: energy === undefined ? undefined : energy === "true",
      };
      if (years.length) event.years = years;
      if (attachmentUris.length) event.attachmentUris = attachmentUris;
      out.push(event);
    }
  };
  collect("grant", GRANT);
  collect("revocation", REVOCATION);
  return out;
}

/**
 * Parse ONE event resource into its `SharingEvent[]` (usually one). The per-event
 * read the React Query fan-out caches: an event is IMMUTABLE once POSTed (append-only,
 * server-minted IRI), so its query is `staleTime: Infinity` — a re-fold after a new
 * share fetches only the new event, not every event.
 */
export async function loadSharingEvent(
  eventUri: string,
  gateway: PodGateway,
): Promise<SharingEvent[]> {
  // OrAbsent, not OrEmpty: a transiently unreadable event must ERROR (React
  // Query retries it on the next mount) — folded as "no events" it would be
  // cached as success under `staleTime: Infinity`, making a revoked share
  // reappear (or a fresh grant vanish) for the rest of the session.
  return parseSharingEvents(await readStoreOrAbsent(eventUri, gateway));
}

/** Read every event resource in a log container (bounded concurrency). The headless
 * fold path; the reactive hooks use the per-event React Query cache instead. */
async function readAllEvents(
  containerUri: string,
  gateway: PodGateway,
): Promise<SharingEvent[]> {
  const eventUris = await listLogEvents(containerUri, gateway);
  // Immutable-event cache + non-empty-only rule live in the shared primitive.
  const parsed = await mapPooled(
    eventUris,
    4,
    (uri) =>
      readEventCached(uri, gateway, parseSharingEvents, (v) => v.length > 0),
  );
  return parsed.flat();
}

/**
 * Fold a log container to the LATEST event per (grantee, resource) pair —
 * grants AND revocations. The latest is by `prov:generatedAtTime`; on an exact
 * timestamp tie a revocation wins (least-privilege; also makes a rapid
 * grant→revoke within the same millisecond deterministic regardless of read
 * order). The revocation side exists so a log replay (`reissueGrants`) can also
 * WITHDRAW enforcement the log says is gone — not just re-apply active grants.
 * @operation query
 */
/**
 * Pure fold: the LATEST event per (grantee, resource) pair (grants AND revocations).
 * Latest by `prov:generatedAtTime`; on an exact tie a revocation wins. Shared by the
 * headless {@link foldSharingLogEvents} and the reactive hooks' `combine` selector so
 * the projection can't drift between them.
 */
export function foldEvents(events: SharingEvent[]): SharingEvent[] {
  const latest = new Map<string, SharingEvent>();
  for (const e of events) {
    const key = `${e.grantee}\n${e.resource}`;
    const prev = latest.get(key);
    const wins = !prev || e.at > prev.at ||
      (e.at === prev.at && e.type === "revocation");
    if (wins) latest.set(key, e);
  }
  return [...latest.values()];
}

/** Pure: the currently-active grants from a set of FOLDED events (drop revocations). */
export function grantsFromEvents(folded: SharingEvent[]): ActiveGrant[] {
  return folded
    .filter((e) => e.type === "grant")
    .map((e): ActiveGrant => {
      const grant: ActiveGrant = {
        owner: e.owner,
        grantee: e.grantee,
        resource: e.resource,
        at: e.at,
        kind: e.kind,
        includesEnergy: e.includesEnergy,
      };
      if (e.years) grant.years = e.years;
      if (e.attachmentUris) grant.attachmentUris = e.attachmentUris;
      return grant;
    });
}

/**
 * The active grants from a set of per-event record lists (flatten → fold → drop
 * revocations). The single derive-at-edge selector both app-facing adapters call — the
 * reactive `useSharingLog` `combine` and the imperative `cachedSharingGrants` peek — so
 * the two can't diverge.
 */
export function activeGrantsFrom(
  eventLists: ReadonlyArray<SharingEvent[] | undefined>,
): ActiveGrant[] {
  return grantsFromEvents(foldEvents(eventLists.flatMap((l) => l ?? [])));
}

export async function foldSharingLogEvents(
  containerUri: string,
  gateway: PodGateway,
): Promise<SharingEvent[]> {
  return foldEvents(await readAllEvents(containerUri, gateway));
}

/**
 * Fold a log container to its currently-active grants: the latest event per
 * (grantee, resource) pair, kept only if it is a grant (a later revocation
 * drops the pair). See {@link foldSharingLogEvents} for the tie-break rule.
 * @operation query
 */
export async function foldSharingLog(
  containerUri: string,
  gateway: PodGateway,
): Promise<ActiveGrant[]> {
  return grantsFromEvents(await foldSharingLogEvents(containerUri, gateway));
}

/**
 * The active grants of a sharing log from the WARM React Query cache — the read-core
 * equivalent of `useSharedInGrants`/`useSharedOutGrants`: read the container listing
 * (`["{containerKey}", webId]`) and each `["sharingEvent", webId, eventUri]` entry, then
 * fold. Returns `null` when the listing or any event isn't cached (cold / partial), so
 * the caller folds fresh. `containerKey` is `"sharedInContainer"` or `"sharedOutContainer"`.
 */
export function cachedSharingGrants(
  webId: string,
  // Derived from the registry so a key rename propagates as a type error at
  // every call site instead of a silently-missed cache.
  containerKey:
    | (typeof queryKeys.sharedInContainer)[0]
    | (typeof queryKeys.sharedOutContainer)[0],
): ActiveGrant[] | null {
  const qc = getAppQueryClient();
  if (!qc) return null;
  const listing = qc.getQueryData<string[]>([containerKey, webId]);
  if (listing === undefined) return null;
  const lists: SharingEvent[][] = [];
  for (const eventUri of listing) {
    const e = qc.getQueryData<SharingEvent[]>([...queryKeys.sharingEvent, webId, eventUri]);
    if (e === undefined) return null; // an event not cached → don't trust a partial fold
    lists.push(e);
  }
  return activeGrantsFrom(lists);
}
