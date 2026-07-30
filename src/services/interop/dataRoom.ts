import type { PodGateway } from "../pod/podGateway.ts";
import { DataFactory, Store, Writer } from "n3";
import type { UserRole } from "../../types.ts";
import {
  ACL_NS,
  AS_NS,
  GRAN_NS,
  LDP_CONTAINS as LDP_CONTAINS_IRI,
  RDF_TYPE,
  RDFS_LABEL,
  SIOC_NS,
  XSD_DATETIME,
  XSD_NS,
} from "../rdf/vocabularies.ts";
import { appRoot, getStorageRoot } from "../pod/solidUtils.ts";
import { readStoreOrEmpty } from "../pod/podFetch.ts";
import {
  appendToContainer,
  ensureContainer,
  putAcl,
  readModifyWrite,
} from "../pod/podWrite.ts";
import { deleteContainerRecursive } from "../pod/podDelete.ts";
import { mapPooled } from "../../lib/pool.ts";
import { readPrefs, setCurrentRoom } from "../prefs.ts";
import {
  addBookmark,
  readBookmarks,
  removeBookmark,
} from "../bookmarks.ts";
import {
  IRI_TO_MEMBERSHIP_ROLE,
  MEMBERSHIP_ROLE_TO_IRI,
} from "../../constants/roles.ts";
import { logError } from "../../lib/logError.ts";
import { listLogEvents, readEventCached } from "../pod/eventLog.ts";

const { blankNode, literal, namedNode } = DataFactory;

const LDP_CONTAINS = namedNode(LDP_CONTAINS_IRI);
const RDF_TYPE_NODE = namedNode(RDF_TYPE);
// Membership events are Activity Streams 2.0 activities; role assignment is an
// as:Update activity carrying the member's roles as SIOC functions.
const AS_JOIN = namedNode(`${AS_NS}Join`);
const AS_LEAVE = namedNode(`${AS_NS}Leave`);
const AS_UPDATE = namedNode(`${AS_NS}Update`);
const AS_ACTOR = namedNode(`${AS_NS}actor`);
const AS_OBJECT = namedNode(`${AS_NS}object`);
const AS_PUBLISHED = namedNode(`${AS_NS}published`);
const SIOC_HAS_FUNCTION = namedNode(`${SIOC_NS}has_function`);

// Membership role ↔ gran: IRI — the single source of truth in constants/roles.ts.
const IRI_TO_ROLE = IRI_TO_MEMBERSHIP_ROLE;

// A GRANERGIZE data room is an append-only LDP container that ANY user can
// create on their OWN Pod (where they have full control). The creator writes an
// ACL granting themselves control and acl:Append to acl:AuthenticatedAgent, so
// anyone can self-join — no central/provider Pod required. The room's container
// IRI is its identity; share it (e.g. as a QR code) so others can join.
//
// Every change POSTs one immutable event resource into the container; the server
// mints a fresh child IRI. Current state is the fold of the container — the
// latest event per WebID wins. Because appends never rewrite a shared resource,
// concurrent saves by different members can't clobber each other. Mirrors the
// inbox pattern (see inbox.ts).
//
// Membership and role assignment are two INDEPENDENT axes, each its own event
// (Activity Streams 2.0 activities; the room is the as:object — conceptually a
// sioc:Usergroup):
//   - as:Join / as:Leave (as:actor, as:published) — whether you are in the room.
//     Folded separately; this alone decides who getMembers returns.
//   - as:Update with sioc:has_function → sioc:Role(s) — which role(s) you hold
//     (a full snapshot; may be empty, and may exist without membership).
// A role event therefore does NOT make you a member: you must post an as:Join.

/** Normalise a room IRI to its canonical LDP-container form (trailing "/"). */
export function normalizeRoomUri(uri: string): string {
  return uri.endsWith("/") ? uri : `${uri}/`;
}

// The room state on the user's OWN Pod is the single source of truth — no
// localStorage. It is split across two single-writer flat files (see prefs.ts /
// bookmarks.ts):
//   prefs.ttl     gran:currentRoom <uri> .   (0 or 1 — the room you're in)
//   bookmarks.ttl gran:knownRoom   <uri> …   (the "Your rooms" list)
// Membership is single: you are a member of the current room only. Rooms you
// host are discovered by listing `rooms/`, not recorded here.

interface RoomRegistry {
  known: string[];
  current: string | null;
}

/** Serialize a store to Turtle text (n3 Writer's callback wrapped as a promise). */
function toTurtle(
  store: Store,
  prefixes: Record<string, string>,
): Promise<string> {
  const writer = new Writer({ format: "text/turtle", prefixes });
  writer.addQuads(store.getQuads(null, null, null, null));
  return new Promise<string>((resolve, reject) =>
    writer.end((err, result) => (err ? reject(err) : resolve(result)))
  );
}

/**
 * Bookmarked room IRIs (the "Your rooms" list).
 * @operation query
 */
export function getKnownRooms(gateway: PodGateway): Promise<string[]> {
  return readBookmarks(gateway);
}

/**
 * The current room recorded on the Pod — the ONE source of that fact for
 * non-hook readers (the share-by-role path); hook code reads it from the
 * `rooms` registry query. There is deliberately NO in-memory mirror: a module
 * global was a third copy of this state, mutated from queries (a CQS leak)
 * and leakable across a re-login.
 * @operation query
 */
export async function getCurrentRoom(gateway: PodGateway): Promise<string | null> {
  return (await readPrefs(gateway)).currentRoom;
}

/**
 * Read both files, hydrate the in-memory current-room mirror, and return the
 * current room plus the bookmark list — the shape the room UI consumes.
 * @operation query
 */
export async function readRooms(gateway: PodGateway): Promise<RoomRegistry> {
  const [prefs, known] = await Promise.all([
    readPrefs(gateway),
    readBookmarks(gateway),
  ]);
  return { known, current: prefs.currentRoom };
}

/**
 * Add a room to the bookmarks list (deduped). Does NOT enter/join it.
 * @operation mutation
 */
export async function addKnownRoom(
  roomUri: string,
  gateway: PodGateway,
): Promise<void> {
  await addBookmark(gateway, normalizeRoomUri(roomUri));
}

/**
 * Remove a room from bookmarks (and clear the current pointer if it was current).
 * @operation mutation
 */
export async function removeKnownRoom(
  roomUri: string,
  gateway: PodGateway,
): Promise<void> {
  const room = normalizeRoomUri(roomUri);
  await removeBookmark(gateway, room);
  if ((await getCurrentRoom(gateway)) === room) {
    await setCurrentRoom(gateway, null);
  }
}

/**
 * Enter a room (single membership): leave whatever room you're in, join this
 * one, bookmark it, and make it the current room.
 * @operation mutation
 */
export async function enterRoom(
  roomUri: string,
  gateway: PodGateway,
  makeCurrent: boolean = true,
): Promise<void> {
  const room = normalizeRoomUri(roomUri);
  // `makeCurrent` governs the single-valued "current room" pointer in prefs.ttl.
  // A BULK creation (the demo-rooms seeder) must pass false: making each of N rooms current
  // rewrites prefs.ttl N times — concurrently with the buildings seed also writing
  // prefs.ttl — which races the conditional PUT past its retry budget and silently
  // drops rooms (an "Added n of total" partial). Joining + bookmarking each room is
  // enough for it to appear; only an interactive single enter sets the pointer.
  if (makeCurrent) {
    const previous = await getCurrentRoom(gateway);
    if (previous && previous !== room) {
      // Best-effort: leaving the previous room must not block joining the new one.
      // The old room may be deleted or no longer writable (e.g. access revoked),
      // which would 403/404 here and otherwise strand the user unable to switch.
      await setMembership(previous, false, gateway).catch((err) =>
        logError("leave previous data room", err)
      );
    }
  }
  if (!(await getMyMembership(room, gateway))) {
    await setMembership(room, true, gateway);
  }
  // Ensure it's bookmarked (so it appears in "Your rooms"). The current pointer is
  // owned by the room mutations and set authoritatively in the React Query cache,
  // so a slow/stale read-back can't revert a switch.
  await addBookmark(gateway, room);
  if (makeCurrent) {
    await setCurrentRoom(gateway, room);
  }
}

/**
 * Leave the current room: stop membership, clear the pointer, keep the bookmark.
 * @operation mutation
 */
export async function exitRoom(
  roomUri: string,
  gateway: PodGateway,
): Promise<void> {
  const room = normalizeRoomUri(roomUri);
  await setMembership(room, false, gateway);
  if ((await getCurrentRoom(gateway)) === room) {
    await setCurrentRoom(gateway, null);
  }
}

/**
 * Whether `roomUri` resolves to a reachable resource (used to validate input).
 * @operation query
 */
export async function roomExists(
  roomUri: string,
  gateway: PodGateway,
): Promise<boolean> {
  try {
    const res = await gateway.fetch(normalizeRoomUri(roomUri), {
      method: "GET",
      headers: { Accept: "text/turtle" },
    });
    return res.ok;
  } catch (err) {
    logError("check data-room reachability", err);
    return false;
  }
}

/**
 * Extract a room container IRI from either a raw room URI or an app invite link
 * of the form `<app root>/room?uri=<uri-encoded-room-uri>` (what the room QR
 * encodes under BrowserRouter real-path routing; a room id is always absolute, so
 * `?uri=` — `?ref=` is tolerated as a fallback). Returns the normalized container
 * IRI. A bare room URI (no `/room?` prefix) is normalized as-is.
 */
export function extractRoomUri(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/\/room\?(?:uri|ref)=([^&#]+)/);
  return normalizeRoomUri(match ? decodeURIComponent(match[1]) : trimmed);
}

/**
 * Open a room: accept a raw URI or an invite link, validate it's reachable, then
 * enter it (leave your previous room, join this one, bookmark it, make it
 * current). Returns false if the room is not reachable.
 * @operation mutation
 */
export async function openRoom(
  input: string,
  gateway: PodGateway,
): Promise<boolean> {
  const room = extractRoomUri(input);
  if (!(await roomExists(room, gateway))) return false;
  await enterRoom(room, gateway);
  return true;
}

export interface DataRoomMember {
  webId: string;
  roles: UserRole[];
}

interface RoleEvent {
  agent: string;
  /** ISO 8601 timestamp; lexical order matches chronological order. */
  at: string;
  roles: UserRole[];
}

interface MembershipEvent {
  agent: string;
  at: string;
  joined: boolean;
}

/** One classified room event, or null (malformed / transient empty read). */
type RoomEvent =
  | { kind: "membership"; event: MembershipEvent }
  | { kind: "role"; event: RoleEvent };

/**
 * Classify one event resource: membership (as:Join/as:Leave) or role
 * assignment (as:Update carrying sioc:has_function). Pure — the fold's
 * per-event half, cached through the shared immutable-event cache.
 */
function classifyRoomEvent(store: Store): RoomEvent | null {
  const joinSubj = store.getSubjects(RDF_TYPE_NODE, AS_JOIN, null)[0];
  const memSubj = joinSubj ??
    store.getSubjects(RDF_TYPE_NODE, AS_LEAVE, null)[0];
  if (memSubj) {
    const agent = store.getObjects(memSubj, AS_ACTOR, null)[0]?.value;
    const at = store.getObjects(memSubj, AS_PUBLISHED, null)[0]?.value;
    if (!agent || !at) return null;
    return {
      kind: "membership",
      event: { agent, at, joined: Boolean(joinSubj) },
    };
  }
  const roleSubj = store.getSubjects(RDF_TYPE_NODE, AS_UPDATE, null)[0];
  if (roleSubj) {
    const agent = store.getObjects(roleSubj, AS_ACTOR, null)[0]?.value;
    const at = store.getObjects(roleSubj, AS_PUBLISHED, null)[0]?.value;
    if (!agent || !at) return null;
    const roles = store.getObjects(roleSubj, SIOC_HAS_FUNCTION, null)
      .map((r) => IRI_TO_ROLE[r.value])
      .filter((r): r is UserRole => Boolean(r));
    return { kind: "role", event: { agent, at, roles } };
  }
  return null;
}

/**
 * Read and classify every event resource in the log container into the two
 * independent streams (membership and role assignment) — through the SAME
 * primitives as the sharing logs (`eventLog.ts`): the listing skips the
 * room's in-place `name` document and auxiliary sidecars by name, and each
 * immutable event parse is cached per gateway (a re-fold costs only the
 * listing). Bounded concurrency: a burst of per-event GETs is what
 * Cloudflare answers with 429s.
 */
async function readLog(
  roomUri: string,
  gateway: PodGateway,
): Promise<{ roleEvents: RoleEvent[]; membershipEvents: MembershipEvent[] }> {
  const containerUri = normalizeRoomUri(roomUri);
  const eventUris = await listLogEvents(containerUri, gateway, {
    exclude: ["name"],
  });
  const parsed = await mapPooled(
    eventUris,
    4,
    (uri) => readEventCached(uri, gateway, classifyRoomEvent, (v) => v !== null),
  );

  const roleEvents: RoleEvent[] = [];
  const membershipEvents: MembershipEvent[] = [];
  for (const p of parsed) {
    if (!p) continue;
    if (p.kind === "role") roleEvents.push(p.event);
    else membershipEvents.push(p.event);
  }
  return { roleEvents, membershipEvents };
}

/**
 * Fold an event stream to the latest event per agent (lexical timestamp
 * order). `tieWins` decides an EXACT timestamp tie (else the first-listed
 * stays) — membership passes leave-wins, mirroring the sharing fold's
 * revocation-wins-on-tie (least privilege, read-order independent).
 */
function latestByAgent<T extends { agent: string; at: string }>(
  events: T[],
  tieWins?: (candidate: T, incumbent: T) => boolean,
): Map<string, T> {
  const latest = new Map<string, T>();
  for (const event of events) {
    const prev = latest.get(event.agent);
    if (
      !prev || event.at > prev.at ||
      (event.at === prev.at && tieWins?.(event, prev))
    ) {
      latest.set(event.agent, event);
    }
  }
  return latest;
}

/**
 * Fold one parsed log into the member list, the caller's roles, and the caller's
 * membership — so a single `readLog` answers all three (avoids reading the whole
 * event log two or three times per room load).
 */
function deriveState(
  log: { roleEvents: RoleEvent[]; membershipEvents: MembershipEvent[] },
  webId: string | null,
): { members: DataRoomMember[]; myRoles: UserRole[]; myMembership: boolean } {
  const latestRole = latestByAgent(log.roleEvents);
  const latestMem = latestByAgent(
    log.membershipEvents,
    (candidate, incumbent) => !candidate.joined && incumbent.joined,
  );
  const members = [...latestMem.values()]
    .filter((m) => m.joined)
    .map((m) => ({ webId: m.agent, roles: latestRole.get(m.agent)?.roles ?? [] }));
  return {
    members,
    myRoles: webId ? latestRole.get(webId)?.roles ?? [] : [],
    myMembership: webId ? latestMem.get(webId)?.joined ?? false : false,
  };
}

/**
 * The members / my-roles / my-membership for a single room (one `readLog`).
 * The UI reads the registry (`current`/`known`, via `readRooms`) and this log
 * state as *separate* React Query keys: the registry is owned by the room
 * mutations (set authoritatively, never refetched, so a slow/stale read-back
 * can't revert a switch), while this log refetches — keyed on the current room —
 * for members and roles.
 * @operation query
 */
export async function getRoomLogState(
  gateway: PodGateway,
  room: string,
): Promise<{ members: DataRoomMember[]; myRoles: UserRole[]; myMembership: boolean }> {
  const webId = gateway.webId ?? null;
  const log = await readLog(normalizeRoomUri(room), gateway);
  return deriveState(log, webId);
}

/**
 * The current data room members: agents whose latest membership event is
 * "joined". Roles are attached from the (independent) role stream and may be
 * empty for a member who has not assigned a role.
 * @operation query
 */
export async function getMembers(
  roomUri: string | null,
  gateway: PodGateway,
): Promise<DataRoomMember[]> {
  if (!roomUri) return [];
  return deriveState(await readLog(roomUri, gateway), null).members;
}

/**
 * Resolve a role to the WebIDs of all members of `roomUri` holding that role,
 * EXCLUDING the logged-in user. Used to pick share recipients, and sharing a
 * resource to yourself is meaningless — and harmful: a self-grant writes a
 * recipient authorization carrying the owner's own `acl:agent`, which a later
 * revoke would then strip along with the owner's full-control block, locking the
 * owner out of their own resource (Tier-4 meisdata run; see `removeFromACL`).
 * @operation query
 */
export async function getMembersByRole(
  roomUri: string | null,
  role: UserRole,
  gateway: PodGateway,
): Promise<string[]> {
  const members = await getMembers(roomUri, gateway);
  const me = gateway.webId;
  return members
    .filter((m) => m.roles.includes(role) && m.webId !== me)
    .map((m) => m.webId);
}

/**
 * The roles the logged-in user has self-assigned in `roomUri`. Independent of
 * membership — reflects the role stream only, so it can be non-empty for someone
 * who has left, or empty for a current member.
 * @operation query
 */
export async function getMyRole(
  roomUri: string | null,
  gateway: PodGateway,
): Promise<UserRole[]> {
  const webId = gateway.webId;
  if (!roomUri || !webId) return [];
  return deriveState(await readLog(roomUri, gateway), webId).myRoles;
}

/**
 * Whether the logged-in user is currently a member of `roomUri`.
 * @operation query
 */
export async function getMyMembership(
  roomUri: string | null,
  gateway: PodGateway,
): Promise<boolean> {
  const webId = gateway.webId;
  if (!roomUri || !webId) return false;
  return deriveState(await readLog(roomUri, gateway), webId).myMembership;
}

/**
 * Append one immutable event resource describing the user's new state. Never
 * rewrites an existing resource — it POSTs a fresh child into the append-only
 * log container, so it's safe under concurrent saves by other members.
 */
async function postEvent(
  roomUri: string,
  store: Store,
  gateway: PodGateway,
): Promise<void> {
  const containerUri = normalizeRoomUri(roomUri);
  const body = await toTurtle(store, {
    as: AS_NS,
    sioc: SIOC_NS,
    gran: GRAN_NS,
    xsd: XSD_NS,
  });

  await ensureContainer(containerUri, gateway);

  await appendToContainer(containerUri, body, gateway, {
    describeError: (res) =>
      res.status === 401 || res.status === 403
        ? `You don't have permission to write to the data room (HTTP ${res.status}). ` +
          `Its owner must grant append access to ${containerUri}.`
        : `Failed to append to data room log (HTTP ${res.status})`,
  });
}

/**
 * Append a role-assignment event recording the user's complete current role set
 * (the fold takes the latest). An empty `roles` clears the user's roles but does
 * NOT remove them from the room — use {@link leaveRoom} for that.
 * @operation mutation
 */
export async function setMyRole(
  roomUri: string,
  roles: UserRole[],
  gateway: PodGateway,
): Promise<void> {
  const webId = gateway.webId;
  if (!webId) throw new Error("Not logged in");
  // Blank-node event subject: the resource IRI is assigned by the server on POST,
  // and the fold matches events by rdf:type, not by subject IRI.
  const event = blankNode();
  const store = new Store();
  store.addQuad(event, RDF_TYPE_NODE, AS_UPDATE);
  store.addQuad(event, AS_ACTOR, namedNode(webId));
  store.addQuad(event, AS_OBJECT, namedNode(normalizeRoomUri(roomUri)));
  store.addQuad(
    event,
    AS_PUBLISHED,
    literal(new Date().toISOString(), namedNode(XSD_DATETIME)),
  );
  for (const role of roles) {
    store.addQuad(event, SIOC_HAS_FUNCTION, namedNode(MEMBERSHIP_ROLE_TO_IRI[role]));
  }
  await postEvent(roomUri, store, gateway);
}

/**
 * Append a membership event (joined/left) to `roomUri`.
 * @operation mutation
 */
async function setMembership(
  roomUri: string,
  joined: boolean,
  gateway: PodGateway,
): Promise<void> {
  const webId = gateway.webId;
  if (!webId) throw new Error("Not logged in");
  const event = blankNode();
  const store = new Store();
  store.addQuad(event, RDF_TYPE_NODE, joined ? AS_JOIN : AS_LEAVE);
  store.addQuad(event, AS_ACTOR, namedNode(webId));
  store.addQuad(event, AS_OBJECT, namedNode(normalizeRoomUri(roomUri)));
  store.addQuad(
    event,
    AS_PUBLISHED,
    literal(new Date().toISOString(), namedNode(XSD_DATETIME)),
  );
  await postEvent(roomUri, store, gateway);
}

/**
 * Add the logged-in user to `roomUri` (no role required).
 * @operation mutation
 */
export function joinRoom(roomUri: string, gateway: PodGateway): Promise<void> {
  return setMembership(roomUri, true, gateway);
}

/**
 * Remove the logged-in user from `roomUri` (leaves role history intact).
 * @operation mutation
 */
export function leaveRoom(roomUri: string, gateway: PodGateway): Promise<void> {
  return setMembership(roomUri, false, gateway);
}

/**
 * Create a new data room on the logged-in user's own Pod and make it the active
 * room. Writes the container plus an ACL granting the creator full control and
 * any authenticated agent read+append, so anyone can self-join. The creator is
 * auto-joined as a member. The room's identity is its (UUID) container IRI.
 * Returns the new room IRI.
 * @operation mutation
 */
export async function createRoom(
  gateway: PodGateway,
  name?: string,
  makeCurrent: boolean = true,
): Promise<string> {
  const webId = gateway.webId;
  if (!webId) throw new Error("Not logged in");
  // Provision the rooms/ parent first (announced once, on the first room) so the
  // structural folder isn't created silently; the per-room UUID container below
  // is then created quietly (it's nested, not a top-level granergize folder).
  await ensureContainer(`${appRoot(webId)}rooms/`, gateway, { announce: true });

  const roomUri = normalizeRoomUri(
    `${appRoot(webId)}rooms/${crypto.randomUUID()}`,
  );

  await ensureContainer(roomUri, gateway);

  const aclUri = `${roomUri}.acl`;
  const res = await putAcl(aclUri, roomAclTurtle(roomUri, webId), gateway);
  if (!res.ok) {
    throw new Error(
      `Created the room but failed to set its permissions (HTTP ${res.status}). ` +
        `Others may be unable to join until ${aclUri} grants append access.`,
    );
  }

  // The creator owns the room — enter it (join, bookmark, make current).
  await enterRoom(roomUri, gateway, makeCurrent);

  // The room's human name lives in a small member-readable resource inside the
  // room (an LDP container can't carry user triples under PUT-only). The
  // container ACL's acl:default grants members Read, so they see the name too.
  const trimmed = name?.trim();
  if (trimmed) await writeRoomName(roomUri, trimmed, gateway);

  return roomUri;
}

/**
 * The canonical room ACL, written the same way the rest of the app writes ACLs
 * (a direct `<container>.acl` PUT with full-IRI triples — see share.ts
 * grantReadAccess): the owner gets control; any authenticated agent may read
 * the log and append events, so anyone can self-join. `acl:default` propagates
 * to the child events. One producer for createRoom AND the rebuild
 * ({@link ensureRoomAcls}), so provision and repair cannot drift.
 */
function roomAclTurtle(roomUri: string, webId: string): string {
  const aclUri = `${roomUri}.acl`;
  return [
    `<${aclUri}#owner> <${RDF_TYPE}> <${ACL_NS}Authorization> .`,
    `<${aclUri}#owner> <${ACL_NS}agent> <${webId}> .`,
    `<${aclUri}#owner> <${ACL_NS}accessTo> <${roomUri}> .`,
    `<${aclUri}#owner> <${ACL_NS}default> <${roomUri}> .`,
    `<${aclUri}#owner> <${ACL_NS}mode> <${ACL_NS}Read> .`,
    `<${aclUri}#owner> <${ACL_NS}mode> <${ACL_NS}Write> .`,
    `<${aclUri}#owner> <${ACL_NS}mode> <${ACL_NS}Control> .`,
    `<${aclUri}#members> <${RDF_TYPE}> <${ACL_NS}Authorization> .`,
    `<${aclUri}#members> <${ACL_NS}agentClass> <${ACL_NS}AuthenticatedAgent> .`,
    `<${aclUri}#members> <${ACL_NS}accessTo> <${roomUri}> .`,
    `<${aclUri}#members> <${ACL_NS}default> <${roomUri}> .`,
    `<${aclUri}#members> <${ACL_NS}mode> <${ACL_NS}Read> .`,
    `<${aclUri}#members> <${ACL_NS}mode> <${ACL_NS}Append> .`,
  ].join("\n") + "\n";
}

/**
 * Reconciliation: re-provision the ACL of every room the user OWNS whose `.acl`
 * is missing. A room ACL is a materialized projection written once at
 * {@link createRoom} with no log to replay it from; an archive restore
 * re-creates the room containers and their event resources but transfers no
 * `.acl`, leaving restored rooms unreadable and unjoinable for members. Owned
 * rooms are discovered by listing `rooms/` (the same discovery the room UI
 * uses); only a MISSING ACL is written — an existing (possibly hand-edited)
 * one is left alone, mirroring reissueGrants' out-of-band rule. Returns the
 * number of ACLs rebuilt.
 * @operation mutation
 */
export async function ensureRoomAcls(gateway: PodGateway): Promise<number> {
  const webId = gateway.webId;
  if (!webId) throw new Error("Not logged in");
  const roomsRoot = `${appRoot(webId)}rooms/`;
  const listing = await readStoreOrEmpty(roomsRoot, gateway);
  const rooms = listing.getObjects(namedNode(roomsRoot), LDP_CONTAINS, null)
    .map((o) => o.value)
    // Only the room containers: some servers (JSS) also list auxiliary
    // sidecars (`rooms/.acl`) in ldp:contains — a child that isn't a
    // container is never a room.
    .filter((uri) => uri.endsWith("/"));
  let rebuilt = 0;
  for (const room of rooms) {
    const aclUri = `${room}.acl`;
    const head = await gateway.fetch(aclUri, { method: "HEAD" });
    if (head.ok) continue;
    const res = await putAcl(aclUri, roomAclTurtle(room, webId), gateway);
    if (!res.ok) {
      throw new Error(
        `Failed to rebuild the room permissions at ${aclUri} (HTTP ${res.status}). ` +
          `Others may be unable to join until it grants append access.`,
      );
    }
    rebuilt++;
  }
  return rebuilt;
}

/** The room's name resource — holds `<room> rdfs:label "name"`. */
function roomNameUri(roomUri: string): string {
  return `${roomUri}name`;
}

/** Write (owner) the room's human name to its name resource. */
function writeRoomName(
  roomUri: string,
  name: string,
  gateway: PodGateway,
): Promise<void> {
  const subject = namedNode(roomUri);
  const pred = namedNode(RDFS_LABEL);
  return readModifyWrite(roomNameUri(roomUri), gateway, (store) => {
    store.removeQuads(store.getQuads(subject, pred, null, null));
    store.addQuad(subject, pred, literal(name));
  });
}

/** A room's human name (`rdfs:label`), or null if unnamed / unreadable. */
export async function readRoomName(
  roomUri: string,
  gateway: PodGateway,
): Promise<string | null> {
  const store = await readStoreOrEmpty(roomNameUri(roomUri), gateway);
  return store.getObjects(namedNode(roomUri), namedNode(RDFS_LABEL), null)[0]
    ?.value ?? null;
}

/** Names of several rooms at once (tolerant — an unreadable room contributes none). */
export async function readRoomNames(
  roomUris: readonly string[],
  gateway: PodGateway,
): Promise<Record<string, string>> {
  const pairs = await Promise.all(
    roomUris.map(async (uri) =>
      [uri, await readRoomName(uri, gateway).catch(() => null)] as const
    ),
  );
  const out: Record<string, string> = {};
  for (const [uri, name] of pairs) if (name) out[uri] = name;
  return out;
}

/** Whether the logged-in user owns `roomUri` (it lives under their own storage). */
export function ownsRoom(roomUri: string, gateway: PodGateway): boolean {
  const webId = gateway.webId;
  return Boolean(webId) &&
    normalizeRoomUri(roomUri).startsWith(getStorageRoot(webId!));
}

/**
 * Delete a room you own: it's just an LDP container under your own storage, so the
 * shared recursive walk empties and removes it (and its `.acl`) — with the stale-
 * listing / 409-self-correction guards the hand-rolled version lacked.
 * @operation mutation
 */
export async function deleteRoom(
  roomUri: string,
  gateway: PodGateway,
): Promise<void> {
  await deleteContainerRecursive(normalizeRoomUri(roomUri), gateway);
}
