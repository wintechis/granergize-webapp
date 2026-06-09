import { Session } from "@inrupt/solid-client-authn-browser";
import { DataFactory, Parser, Store, Writer } from "n3";
import type { UserRole } from "../../types.ts";
import {
  ACL_NS,
  AS_NS,
  GRAN_NS,
  LDP_CONTAINS as LDP_CONTAINS_IRI,
  RDF_TYPE,
  SIOC_NS,
  XSD_DATETIME,
} from "../rdf/vocabularies.ts";
import { appRoot, getStorageRoot } from "../pod/solidUtils.ts";
import { fetchFresh, readStoreOrEmpty } from "../pod/podFetch.ts";
import { ensureContainer, putAcl } from "../pod/podWrite.ts";
import { mapPooled } from "../../lib/pool.ts";
import { readPrefs, setCurrentRoom } from "../prefs.ts";
import {
  addBookmark,
  readBookmarks,
  removeBookmark,
} from "../bookmarks.ts";
import { IRI_TO_PROVENANCE, PROVENANCE_TO_IRI } from "../../constants/roles.ts";
import { logError } from "../../lib/logError.ts";

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

// Membership role ↔ gran: IRI is the same mapping as a building's provenance
// role; reuse the single source of truth in constants/roles.ts.
const ROLE_TO_IRI = PROVENANCE_TO_IRI;
const IRI_TO_ROLE = IRI_TO_PROVENANCE;

// A GRANERGIZE data room is an append-only LDP container that ANY user can
// create on their OWN Pod (where they have full control). The creator writes an
// ACL granting themselves control and acl:Append to acl:AuthenticatedAgent, so
// anyone can self-join — no central/provider Pod required. The room's container
// URL is its identity; share it (e.g. as a QR code) so others can join.
//
// Every change POSTs one immutable event resource into the container; the server
// mints a fresh child URL. Current state is the fold of the container — the
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

/** Normalise a room URL to its canonical LDP-container form (trailing "/"). */
export function normalizeRoomUrl(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

// In-memory mirror of the Pod's current-room pointer, so components can read the
// current room synchronously (the sharing dialogs use getActiveRoom). Hydrated
// from the Pod on load via hydrateActiveRoom; updated by enterRoom/leaveRoom.
let activeRoom: string | null = null;

/** The room the user is currently in, or null. Mirrors the Pod's pointer. */
export function getActiveRoom(): string | null {
  return activeRoom;
}

/**
 * Clear the in-memory current-room pointer. Unlike the WebID-namespaced React
 * Query cache, this bare module global would otherwise survive a
 * logout→login-as-different-user in the same tab and briefly target the previous
 * user's room. Call on every logout / session-expiry path (see main.tsx);
 * re-login rehydrates it from the new user's Pod via hydrateActiveRoom.
 */
export function resetActiveRoom(): void {
  activeRoom = null;
}

// The room state on the user's OWN Pod is the single source of truth — no
// localStorage. It is split across two single-writer flat files (see prefs.ts /
// bookmarks.ts):
//   prefs.ttl     gran:currentRoom <url> .   (0 or 1 — the room you're in)
//   bookmarks.ttl gran:knownRoom   <url> …   (the "Your rooms" list)
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
 * Bookmarked room URLs (the "Your rooms" list).
 * @operation query
 */
export function getKnownRooms(session: Session): Promise<string[]> {
  return readBookmarks(session);
}

/**
 * The current room recorded on the Pod (source of truth for getActiveRoom).
 * @operation query
 */
export async function getCurrentRoom(session: Session): Promise<string | null> {
  return (await readPrefs(session)).currentRoom;
}

/**
 * Read both files, hydrate the in-memory current-room mirror, and return the
 * current room plus the bookmark list — the shape the room UI consumes.
 * @operation query
 */
export async function readRooms(session: Session): Promise<RoomRegistry> {
  const [prefs, known] = await Promise.all([
    readPrefs(session),
    readBookmarks(session),
  ]);
  activeRoom = prefs.currentRoom;
  return { known, current: prefs.currentRoom };
}

/**
 * Load the Pod's current-room pointer into memory so getActiveRoom works.
 * @operation query
 */
export async function hydrateActiveRoom(
  session: Session,
): Promise<string | null> {
  activeRoom = (await readPrefs(session)).currentRoom;
  return activeRoom;
}

/**
 * Add a room to the bookmarks list (deduped). Does NOT enter/join it.
 * @operation mutation
 */
export async function addKnownRoom(
  roomUrl: string,
  session: Session,
): Promise<void> {
  await addBookmark(session, normalizeRoomUrl(roomUrl));
}

/**
 * Remove a room from bookmarks (and clear the current pointer if it was current).
 * @operation mutation
 */
export async function removeKnownRoom(
  roomUrl: string,
  session: Session,
): Promise<void> {
  const room = normalizeRoomUrl(roomUrl);
  await removeBookmark(session, room);
  if ((await getCurrentRoom(session)) === room) {
    await setCurrentRoom(session, null);
  }
  if (activeRoom === room) activeRoom = null;
}

/**
 * Enter a room (single membership): leave whatever room you're in, join this
 * one, bookmark it, and make it the current room (persisted + in memory).
 * @operation mutation
 */
export async function enterRoom(
  roomUrl: string,
  session: Session,
): Promise<void> {
  const room = normalizeRoomUrl(roomUrl);
  const previous = await getCurrentRoom(session);
  if (previous && previous !== room) {
    // Best-effort: leaving the previous room must not block joining the new one.
    // The old room may be deleted or no longer writable (e.g. access revoked),
    // which would 403/404 here and otherwise strand the user unable to switch.
    await setMembership(previous, false, session).catch((err) =>
      logError("leave previous data room", err)
    );
  }
  if (!(await getMyMembership(room, session))) {
    await setMembership(room, true, session);
  }
  // Ensure it's bookmarked and make it current. The current pointer is owned by
  // the room mutations and set authoritatively in the React Query cache, so a
  // slow/stale read-back can't revert a switch.
  await addBookmark(session, room);
  await setCurrentRoom(session, room);
  activeRoom = room;
}

/**
 * Leave the current room: stop membership, clear the pointer, keep the bookmark.
 * @operation mutation
 */
export async function exitRoom(
  roomUrl: string,
  session: Session,
): Promise<void> {
  const room = normalizeRoomUrl(roomUrl);
  await setMembership(room, false, session);
  if ((await getCurrentRoom(session)) === room) {
    await setCurrentRoom(session, null);
  }
  if (activeRoom === room) activeRoom = null;
}

/**
 * Whether `roomUrl` resolves to a reachable resource (used to validate input).
 * @operation query
 */
export async function roomExists(
  roomUrl: string,
  session: Session,
): Promise<boolean> {
  try {
    const res = await session.fetch(normalizeRoomUrl(roomUrl), {
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
 * Extract a room container URL from either a raw room URI or an app invite link
 * of the form `…#/room/<url-encoded-room-uri>` (what the room QR encodes). Returns
 * the normalized container URL.
 */
export function extractRoomUrl(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/#\/room\/([^?&#]+)/);
  return normalizeRoomUrl(match ? decodeURIComponent(match[1]) : trimmed);
}

/**
 * Open a room: accept a raw URI or an invite link, validate it's reachable, then
 * enter it (leave your previous room, join this one, bookmark it, make it
 * current). Returns false if the room is not reachable.
 * @operation mutation
 */
export async function openRoom(
  input: string,
  session: Session,
): Promise<boolean> {
  const room = extractRoomUrl(input);
  if (!(await roomExists(room, session))) return false;
  await enterRoom(room, session);
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

/**
 * Read and classify every event resource in the log container into the two
 * independent streams (membership and role assignment) in a single pass.
 */
async function readLog(
  roomUrl: string,
  session: Session,
): Promise<{ roleEvents: RoleEvent[]; membershipEvents: MembershipEvent[] }> {
  const containerUrl = normalizeRoomUrl(roomUrl);
  // fetchFresh bypasses caches so we always read the current container listing;
  // baseIRI below stays canonical (the cache-buster is only on the request URL).
  const response = await fetchFresh(containerUrl, session);
  if (!response.ok) {
    if (response.status === 404) return { roleEvents: [], membershipEvents: [] };
    throw new Error(`Failed to load data room log (HTTP ${response.status})`);
  }

  const listing = new Store(
    new Parser({ baseIRI: containerUrl }).parse(await response.text()),
  );
  const eventUrls = listing.getObjects(
    namedNode(containerUrl),
    LDP_CONTAINS,
    null,
  ).map((o) => o.value);

  // Bounded concurrency, not Promise.all: reading every event at once is a burst
  // that Cloudflare answers with 429s (opaque CORS errors in the browser). A small
  // pool keeps each wave under the rate limit. See utils/pool.ts.
  const parsed = await mapPooled(eventUrls, 4, async (url) => {
    const store = await readStoreOrEmpty(url, session);

    // Membership: as:Join / as:Leave.
    const joinSubj = store.getSubjects(RDF_TYPE_NODE, AS_JOIN, null)[0];
    const memSubj = joinSubj ??
      store.getSubjects(RDF_TYPE_NODE, AS_LEAVE, null)[0];
    if (memSubj) {
      const agent = store.getObjects(memSubj, AS_ACTOR, null)[0]?.value;
      const at = store.getObjects(memSubj, AS_PUBLISHED, null)[0]?.value;
      if (!agent || !at) return null;
      return {
        kind: "membership" as const,
        event: { agent, at, joined: Boolean(joinSubj) },
      };
    }

    // Role assignment: as:Update carrying sioc:has_function → role(s).
    const roleSubj = store.getSubjects(RDF_TYPE_NODE, AS_UPDATE, null)[0];
    if (roleSubj) {
      const agent = store.getObjects(roleSubj, AS_ACTOR, null)[0]?.value;
      const at = store.getObjects(roleSubj, AS_PUBLISHED, null)[0]?.value;
      if (!agent || !at) return null;
      const roles = store.getObjects(roleSubj, SIOC_HAS_FUNCTION, null)
        .map((r) => IRI_TO_ROLE[r.value])
        .filter((r): r is UserRole => Boolean(r));
      return { kind: "role" as const, event: { agent, at, roles } };
    }
    return null;
  });

  const roleEvents: RoleEvent[] = [];
  const membershipEvents: MembershipEvent[] = [];
  for (const p of parsed) {
    if (!p) continue;
    if (p.kind === "role") roleEvents.push(p.event);
    else membershipEvents.push(p.event);
  }
  return { roleEvents, membershipEvents };
}

/** Fold an event stream to the latest event per agent (lexical timestamp order). */
function latestByAgent<T extends { agent: string; at: string }>(
  events: T[],
): Map<string, T> {
  const latest = new Map<string, T>();
  for (const event of events) {
    const prev = latest.get(event.agent);
    if (!prev || event.at > prev.at) latest.set(event.agent, event);
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
  const latestMem = latestByAgent(log.membershipEvents);
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
  session: Session,
  room: string,
): Promise<{ members: DataRoomMember[]; myRoles: UserRole[]; myMembership: boolean }> {
  const webId = session.info.webId ?? null;
  const log = await readLog(normalizeRoomUrl(room), session);
  return deriveState(log, webId);
}

/**
 * The current data room members: agents whose latest membership event is
 * "joined". Roles are attached from the (independent) role stream and may be
 * empty for a member who has not assigned a role.
 * @operation query
 */
export async function getMembers(
  roomUrl: string | null,
  session: Session,
): Promise<DataRoomMember[]> {
  if (!roomUrl) return [];
  return deriveState(await readLog(roomUrl, session), null).members;
}

/**
 * Resolve a role to the WebIDs of all members of `roomUrl` holding that role,
 * EXCLUDING the logged-in user. Used to pick share recipients, and sharing a
 * resource to yourself is meaningless — and harmful: a self-grant writes a
 * recipient authorization carrying the owner's own `acl:agent`, which a later
 * revoke would then strip along with the owner's full-control block, locking the
 * owner out of their own resource (Tier-4 meisdata run; see `removeFromACL`).
 * @operation query
 */
export async function getMembersByRole(
  roomUrl: string | null,
  role: UserRole,
  session: Session,
): Promise<string[]> {
  const members = await getMembers(roomUrl, session);
  const me = session.info.webId;
  return members
    .filter((m) => m.roles.includes(role) && m.webId !== me)
    .map((m) => m.webId);
}

/**
 * The roles the logged-in user has self-assigned in `roomUrl`. Independent of
 * membership — reflects the role stream only, so it can be non-empty for someone
 * who has left, or empty for a current member.
 * @operation query
 */
export async function getMyRole(
  roomUrl: string | null,
  session: Session,
): Promise<UserRole[]> {
  const webId = session.info.webId;
  if (!roomUrl || !webId) return [];
  return deriveState(await readLog(roomUrl, session), webId).myRoles;
}

/**
 * Whether the logged-in user is currently a member of `roomUrl`.
 * @operation query
 */
export async function getMyMembership(
  roomUrl: string | null,
  session: Session,
): Promise<boolean> {
  const webId = session.info.webId;
  if (!roomUrl || !webId) return false;
  return deriveState(await readLog(roomUrl, session), webId).myMembership;
}

/**
 * Append one immutable event resource describing the user's new state. Never
 * rewrites an existing resource — it POSTs a fresh child into the append-only
 * log container, so it's safe under concurrent saves by other members.
 */
async function postEvent(
  roomUrl: string,
  store: Store,
  session: Session,
): Promise<void> {
  const containerUrl = normalizeRoomUrl(roomUrl);
  const body = await toTurtle(store, {
    as: AS_NS,
    sioc: SIOC_NS,
    gran: GRAN_NS,
    xsd: "http://www.w3.org/2001/XMLSchema#",
  });

  await ensureContainer(containerUrl, session);

  const res = await session.fetch(containerUrl, {
    method: "POST",
    headers: { "Content-Type": "text/turtle" },
    body,
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `You don't have permission to write to the data room (HTTP ${res.status}). ` +
          `Its owner must grant append access to ${containerUrl}.`,
      );
    }
    throw new Error(`Failed to append to data room log (HTTP ${res.status})`);
  }
}

/**
 * Append a role-assignment event recording the user's complete current role set
 * (the fold takes the latest). An empty `roles` clears the user's roles but does
 * NOT remove them from the room — use {@link leaveRoom} for that.
 * @operation mutation
 */
export async function setMyRole(
  roomUrl: string,
  roles: UserRole[],
  session: Session,
): Promise<void> {
  const webId = session.info.webId;
  if (!webId) throw new Error("Not logged in");
  // Blank-node event subject: the resource URL is assigned by the server on POST,
  // and the fold matches events by rdf:type, not by subject IRI.
  const event = blankNode();
  const store = new Store();
  store.addQuad(event, RDF_TYPE_NODE, AS_UPDATE);
  store.addQuad(event, AS_ACTOR, namedNode(webId));
  store.addQuad(event, AS_OBJECT, namedNode(normalizeRoomUrl(roomUrl)));
  store.addQuad(
    event,
    AS_PUBLISHED,
    literal(new Date().toISOString(), namedNode(XSD_DATETIME)),
  );
  for (const role of roles) {
    store.addQuad(event, SIOC_HAS_FUNCTION, namedNode(ROLE_TO_IRI[role]));
  }
  await postEvent(roomUrl, store, session);
}

/**
 * Append a membership event (joined/left) to `roomUrl`.
 * @operation mutation
 */
async function setMembership(
  roomUrl: string,
  joined: boolean,
  session: Session,
): Promise<void> {
  const webId = session.info.webId;
  if (!webId) throw new Error("Not logged in");
  const event = blankNode();
  const store = new Store();
  store.addQuad(event, RDF_TYPE_NODE, joined ? AS_JOIN : AS_LEAVE);
  store.addQuad(event, AS_ACTOR, namedNode(webId));
  store.addQuad(event, AS_OBJECT, namedNode(normalizeRoomUrl(roomUrl)));
  store.addQuad(
    event,
    AS_PUBLISHED,
    literal(new Date().toISOString(), namedNode(XSD_DATETIME)),
  );
  await postEvent(roomUrl, store, session);
}

/**
 * Add the logged-in user to `roomUrl` (no role required).
 * @operation mutation
 */
export function joinRoom(roomUrl: string, session: Session): Promise<void> {
  return setMembership(roomUrl, true, session);
}

/**
 * Remove the logged-in user from `roomUrl` (leaves role history intact).
 * @operation mutation
 */
export function leaveRoom(roomUrl: string, session: Session): Promise<void> {
  return setMembership(roomUrl, false, session);
}

/**
 * Create a new data room on the logged-in user's own Pod and make it the active
 * room. Writes the container plus an ACL granting the creator full control and
 * any authenticated agent read+append, so anyone can self-join. The creator is
 * auto-joined as a member. The room's identity is its (UUID) container URL.
 * Returns the new room URL.
 * @operation mutation
 */
export async function createRoom(session: Session): Promise<string> {
  const webId = session.info.webId;
  if (!webId) throw new Error("Not logged in");
  // Provision the rooms/ parent first (announced once, on the first room) so the
  // structural folder isn't created silently; the per-room UUID container below
  // is then created quietly (it's nested, not a top-level granergize folder).
  await ensureContainer(`${appRoot(webId)}rooms/`, session);

  const roomUrl = normalizeRoomUrl(
    `${appRoot(webId)}rooms/${crypto.randomUUID()}`,
  );

  await ensureContainer(roomUrl, session);

  // Write the room ACL the same way the rest of the app does (a direct
  // <container>.acl PUT with full-IRI triples — see share.ts grantReadAccess):
  // owner gets control; any authenticated agent may read the log and append
  // events, so anyone can self-join. acl:default propagates to the child events.
  const aclUrl = `${roomUrl}.acl`;
  const aclBody = [
    `<${aclUrl}#owner> <${RDF_TYPE}> <${ACL_NS}Authorization> .`,
    `<${aclUrl}#owner> <${ACL_NS}agent> <${webId}> .`,
    `<${aclUrl}#owner> <${ACL_NS}accessTo> <${roomUrl}> .`,
    `<${aclUrl}#owner> <${ACL_NS}default> <${roomUrl}> .`,
    `<${aclUrl}#owner> <${ACL_NS}mode> <${ACL_NS}Read> .`,
    `<${aclUrl}#owner> <${ACL_NS}mode> <${ACL_NS}Write> .`,
    `<${aclUrl}#owner> <${ACL_NS}mode> <${ACL_NS}Control> .`,
    `<${aclUrl}#members> <${RDF_TYPE}> <${ACL_NS}Authorization> .`,
    `<${aclUrl}#members> <${ACL_NS}agentClass> <${ACL_NS}AuthenticatedAgent> .`,
    `<${aclUrl}#members> <${ACL_NS}accessTo> <${roomUrl}> .`,
    `<${aclUrl}#members> <${ACL_NS}default> <${roomUrl}> .`,
    `<${aclUrl}#members> <${ACL_NS}mode> <${ACL_NS}Read> .`,
    `<${aclUrl}#members> <${ACL_NS}mode> <${ACL_NS}Append> .`,
  ].join("\n") + "\n";

  const res = await putAcl(aclUrl, aclBody, session);
  if (!res.ok) {
    throw new Error(
      `Created the room but failed to set its permissions (HTTP ${res.status}). ` +
        `Others may be unable to join until ${aclUrl} grants append access.`,
    );
  }

  // The creator owns the room — enter it (join, bookmark, make current).
  await enterRoom(roomUrl, session);
  return roomUrl;
}

/** Whether the logged-in user owns `roomUrl` (it lives under their own storage). */
export function ownsRoom(roomUrl: string, session: Session): boolean {
  const webId = session.info.webId;
  return Boolean(webId) &&
    normalizeRoomUrl(roomUrl).startsWith(getStorageRoot(webId!));
}

/**
 * Delete a room you own: remove all its event resources, then its ACL, then the
 * container itself (LDP containers must be emptied before they can be deleted).
 * @operation mutation
 */
export async function deleteRoom(
  roomUrl: string,
  session: Session,
): Promise<void> {
  const container = normalizeRoomUrl(roomUrl);
  const store = await readStoreOrEmpty(container, session);
  const children = store.getObjects(namedNode(container), LDP_CONTAINS, null)
    .map((o) => o.value);
  // Bounded concurrency (not Promise.all) to avoid a delete burst tripping the
  // rate limit. See utils/pool.ts.
  await mapPooled(children, 4, (c) => session.fetch(c, { method: "DELETE" }));
  // Best-effort ACL removal; deleting the container is what matters.
  await session.fetch(`${container}.acl`, { method: "DELETE" }).catch((err) =>
    logError("delete data-room container ACL", err)
  );
  const del = await session.fetch(container, { method: "DELETE" });
  if (!del.ok && del.status !== 404) {
    throw new Error(`Failed to delete room (HTTP ${del.status})`);
  }
}

/** Create the container if it doesn't exist yet (idempotent). */
