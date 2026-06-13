import { Session } from "@inrupt/solid-client-authn-browser";
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
} from "../rdf/vocabularies.ts";
import { podResources } from "../pod/solidUtils.ts";
import { readStoreOrEmpty } from "../pod/podFetch.ts";
import { appendToContainer, ensureContainer } from "../pod/podWrite.ts";
import { listDirectChildren } from "../pod/podDelete.ts";
import { mapPooled } from "../../lib/pool.ts";

const { namedNode } = DataFactory;

/**
 * The sharing event logs. Two symmetric, append-only LDP containers under
 * `granergize/`, one event resource each (POST → the server mints the child URL,
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
 *      prov:generatedAtTime   "…"^^xsd:dateTime . # rec:Building | cons:View
 *
 * A revocation is `a interop:AccessRevocation` with the same (grantee, resource)
 * and a later time, and no accessMode/kind. Current state = fold the log: group
 * by (grantee, resource), take the latest event; the pair is active iff that
 * latest event is a grant. The WAC `.acl` stays the enforcement truth — these
 * logs are the app's *record* (history) and the only way a recipient learns of an
 * inbound grant (it lives in the sharer's `.acl`, reachable only via the inbox).
 */
export type SharingKind = "Building" | "View";

export interface SharingEvent {
  type: "grant" | "revocation";
  owner: string; // the sharer (prov:wasAssociatedWith)
  grantee: string; // the recipient (interop:grantee)
  resource: string; // interop:forResource
  at: string; // prov:generatedAtTime (ISO 8601)
  kind?: SharingKind; // grant only (routing hint)
  includesEnergy?: boolean; // grant hint only
  /**
   * The granted energy years (grant only). Absent/empty ⇒ all years (the
   * `includesEnergy` boolean alone governs). Recorded so the log is self-sufficient
   * for replay (`reissueGrants`) — a per-year grant's exact scope lives here, not
   * only in the derived `.acl`. See the "always replayable" sharing principle.
   */
  years?: number[];
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
const WAS_ASSOCIATED_WITH = namedNode(PROV_WAS_ASSOCIATED_WITH);
const GENERATED_AT = namedNode(PROV_GENERATED_AT_TIME);
const KIND = namedNode(`${GRAN_NS}kind`);

/** Sharing kind ↔ the shared resource's class IRI (the `gran:kind` value). */
const KIND_TO_IRI: Record<SharingKind, string> = {
  Building: REC_BUILDING,
  View: `${CONSUMPTION_NS}View`,
};

/** Serialize one event resource (subject `<>` — the resource *is* the event). */
export function buildSharingEventTurtle(e: SharingEvent): string {
  const triples = [
    `a interop:${e.type === "grant" ? "AccessGrant" : "AccessRevocation"}`,
    `prov:wasAssociatedWith <${e.owner}>`,
    `interop:grantee <${e.grantee}>`,
    `interop:forResource <${e.resource}>`,
  ];
  if (e.type === "grant") {
    triples.push("interop:accessMode acl:Read");
    if (e.kind) triples.push(`gran:kind <${KIND_TO_IRI[e.kind]}>`);
    if (e.includesEnergy !== undefined) {
      triples.push(`interop:includesEnergyData "${e.includesEnergy}"^^xsd:boolean`);
    }
    // Per-year scope (absent ⇒ all years). One triple per granted year so the
    // log fully captures a per-year share for faithful replay.
    for (const year of e.years ?? []) {
      triples.push(`interop:includesEnergyYear "${year}"^^xsd:gYear`);
    }
  }
  triples.push(`prov:generatedAtTime "${e.at}"^^xsd:dateTime`);
  return [
    `@prefix interop: <${INTEROP_NS}> .`,
    `@prefix prov: <${PROV_NS}> .`,
    `@prefix acl: <${ACL_NS}> .`,
    `@prefix gran: <${GRAN_NS}> .`,
    `@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .`,
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
  session: Session,
  event: SharingEvent,
): Promise<void> {
  // Announce: a first event lazily provisions shared-out//shared-in/, a creation
  // the user wouldn't otherwise see.
  await ensureContainer(containerUri, session, { announce: true });
  await appendToContainer(containerUri, buildSharingEventTurtle(event), session, {
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
      const kind: SharingKind | undefined = kindIri === KIND_TO_IRI.View
        ? "View"
        : kindIri === KIND_TO_IRI.Building
        ? "Building"
        : undefined;
      const energy = store.getObjects(subj, INCLUDES_ENERGY, null)[0]?.value;
      const years = store.getObjects(subj, INCLUDES_ENERGY_YEAR, null)
        .map((o) => parseInt(o.value, 10))
        .filter((y) => Number.isFinite(y))
        .sort((a, b) => a - b);
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
      out.push(event);
    }
  };
  collect("grant", GRANT);
  collect("revocation", REVOCATION);
  return out;
}

/**
 * Parsed events per event URL, scoped per Session (so a fresh login — or a
 * fresh fake session in tests — never sees another's entries). An event
 * resource is IMMUTABLE once POSTed (append-only log, server-minted IRI, never
 * rewritten), so its parse can be reused for the session's lifetime: a re-fold
 * then costs only the container listing, not one GET per event. Only non-empty
 * parses are cached — an empty result can be a TRANSIENT failure
 * (`readStoreOrEmpty` degrades 403/throttle to an empty store) and must stay
 * retryable.
 */
const eventCacheBySession = new WeakMap<Session, Map<string, SharingEvent[]>>();

/** Read every event resource in a log container (bounded concurrency). */
async function readAllEvents(
  containerUri: string,
  session: Session,
): Promise<SharingEvent[]> {
  const children = await listDirectChildren(containerUri, session);
  if (!children) return []; // container doesn't exist yet
  const eventUris = children.filter((u) => !u.endsWith("/"));
  const cache = eventCacheBySession.get(session) ??
    new Map<string, SharingEvent[]>();
  eventCacheBySession.set(session, cache);
  const parsed = await mapPooled(eventUris, 4, async (url) => {
    const cached = cache.get(url);
    if (cached) return cached;
    const events = parseSharingEvents(await readStoreOrEmpty(url, session));
    if (events.length > 0) cache.set(url, events);
    return events;
  });
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
export async function foldSharingLogEvents(
  containerUri: string,
  session: Session,
): Promise<SharingEvent[]> {
  const events = await readAllEvents(containerUri, session);
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

/**
 * Fold a log container to its currently-active grants: the latest event per
 * (grantee, resource) pair, kept only if it is a grant (a later revocation
 * drops the pair). See {@link foldSharingLogEvents} for the tie-break rule.
 * @operation query
 */
export async function foldSharingLog(
  containerUri: string,
  session: Session,
): Promise<ActiveGrant[]> {
  return (await foldSharingLogEvents(containerUri, session))
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
      return grant;
    });
}
