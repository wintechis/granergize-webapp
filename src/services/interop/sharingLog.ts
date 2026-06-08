import { Session } from "@inrupt/solid-client-authn-browser";
import { DataFactory, Store } from "n3";
import {
  ACL_NS,
  GRAN_NS,
  INTEROP_NS,
  PROV_GENERATED_AT_TIME,
  PROV_NS,
  PROV_WAS_ASSOCIATED_WITH,
  RDF_TYPE,
} from "../utils/vocabularies.ts";
import { appRoot } from "../utils/solidUtils.ts";
import { readStoreOrEmpty } from "../utils/podFetch.ts";
import { ensureContainer } from "../utils/podWrite.ts";
import { listDirectChildren } from "../utils/podDelete.ts";
import { mapPooled } from "../utils/pool.ts";

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
 *      gran:kind              gran:Building ;     # Building | View (routing hint)
 *      prov:generatedAtTime   "…"^^xsd:dateTime .
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
export function sharedInUrl(webId: string): string {
  return `${appRoot(webId)}shared-in/`;
}

/** `granergize/shared-out/` — sharing performed (history + "shared with" badge). */
export function sharedOutUrl(webId: string): string {
  return `${appRoot(webId)}shared-out/`;
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
    if (e.kind) triples.push(`gran:kind gran:${e.kind}`);
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
  containerUrl: string,
  session: Session,
  event: SharingEvent,
): Promise<void> {
  await ensureContainer(containerUrl, session);
  const res = await session.fetch(containerUrl, {
    method: "POST",
    headers: { "Content-Type": "text/turtle" },
    body: buildSharingEventTurtle(event),
  });
  if (!res.ok) {
    throw new Error(`Failed to append sharing event (HTTP ${res.status})`);
  }
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
      const kind: SharingKind | undefined = kindIri === `${GRAN_NS}View`
        ? "View"
        : kindIri === `${GRAN_NS}Building`
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

/** Read every event resource in a log container (bounded concurrency). */
async function readAllEvents(
  containerUrl: string,
  session: Session,
): Promise<SharingEvent[]> {
  const children = await listDirectChildren(containerUrl, session);
  if (!children) return []; // container doesn't exist yet
  const eventUrls = children.filter((u) => !u.endsWith("/"));
  const parsed = await mapPooled(eventUrls, 4, async (url) => {
    return parseSharingEvents(await readStoreOrEmpty(url, session));
  });
  return parsed.flat();
}

/**
 * Fold a log container to its currently-active grants: group events by
 * (grantee, resource), keep the latest by `prov:generatedAtTime`, and emit it
 * only if that latest event is a grant (a later revocation drops the pair). On an
 * exact timestamp tie a revocation wins (least-privilege; also makes a rapid
 * grant→revoke within the same millisecond deterministic regardless of read
 * order).
 * @operation query
 */
export async function foldSharingLog(
  containerUrl: string,
  session: Session,
): Promise<ActiveGrant[]> {
  const events = await readAllEvents(containerUrl, session);
  const latest = new Map<string, SharingEvent>();
  for (const e of events) {
    const key = `${e.grantee}\n${e.resource}`;
    const prev = latest.get(key);
    const wins = !prev || e.at > prev.at ||
      (e.at === prev.at && e.type === "revocation");
    if (wins) latest.set(key, e);
  }
  return [...latest.values()]
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
