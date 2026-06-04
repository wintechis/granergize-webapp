# Data Rooms (membership & roles)

A data room is an **append-only LDP container** any user creates on their own Pod.
State is **event-sourced**: join, leave, and role changes each append one immutable
event; current state is **derived on read** by folding (latest event per WebID, per
axis). Append-only POSTs give an audit trail and avoid lost-update races.

Code: [`dataRoom.ts`](src/services/interop/dataRoom.ts); UI
[`ConnectPage.tsx`](src/pages/ConnectPage.tsx); IRIs in
[`vocabularies.ts`](src/services/utils/vocabularies.ts).

**Single room at a time:** you are a member of at most one room — the *current*
room. Entering another room leaves the one you were in. A persistent **bookmarks**
list lets you switch between rooms you know about.

Two **independent axes**: **membership** (in the room or not) and **role(s) held**.
You can be a member with no role, or have left while role history remains.

## Storage

- **Identity = container URL**, e.g. `https://alice.example/granergize/rooms/<uuid>/`
  (`createRoom`).
- **ACL**: creator `acl:Control`; any authenticated agent `acl:Read` + `acl:Append`
  (open self-enrollment). No central room — share the URL/QR so others can join.
- Appends via **LDP container `POST`** (server mints each child URL); the Pod applies
  no SPARQL `PATCH`.

### Room registry on your Pod (no localStorage)

A single registry `…/granergize/rooms.ttl` on your **own** Pod is the source of truth
for both the list and the current room (so they survive reloads and work across
devices):

- `<registry> gran:knownRoom <url> …` — your **bookmarks** ("Your rooms"). Added by
  create / add-URI / scan; they **survive leaving**.
- `<registry> gran:currentRoom <url>` — the **one room you're in** (0 or 1).

`getActiveRoom()` reads an in-memory mirror of `currentRoom` (so components like the
sharing dialogs can read it synchronously); `hydrateActiveRoom` loads it from the Pod
on login, and `enterRoom`/`exitRoom` keep both in sync.

## Events (Activity Streams 2.0 + SIOC)

Each event uses a blank-node subject with `as:actor` (WebID), `as:object` (the room),
`as:published` (ISO time); it is a **full snapshot**, not a delta. SIOC alone is
state-centric (`sioc:has_member` is a fact, not an event), so AS2 supplies the verbs.

**Membership** — `joinRoom`/`leaveRoom` → `setMembership`:

```turtle
@prefix as: <https://www.w3.org/ns/activitystreams#> .
[] a as:Join ;                                   # as:Leave to leave
   as:actor <…/card#me> ; as:object <…/rooms/uuid/> ;
   as:published "2026-05-29T10:00:00Z"^^xsd:dateTime .
```

**Role** — `setMyRole`: `as:Update` carrying the full role set as `sioc:has_function`
→ `sioc:Role` IRIs (may be empty):

```turtle
[] a as:Update ;
   as:actor <…/card#me> ; as:object <…/rooms/uuid/> ; as:published "…"^^xsd:dateTime ;
   sioc:has_function gran:InvestorRole, gran:UserRoleInstance .
```

Role IRIs (`ROLE_TO_IRI`): `investor`→`gran:InvestorRole`, `user`→
`gran:UserRoleInstance`, `benchmark_service_provider`→`gran:BenchmarkRole`,
`dummy`→`gran:DummyRole`.

## Operations & fold

- **Join** — `joinRoom`; event `as:Join`; current state: latest membership = `as:Join` → member.
- **Leave** — `leaveRoom`; event `as:Leave`; current state: latest membership = `as:Leave` → not a member.
- **Set role(s)** — `setMyRole`; event `as:Update` + `sioc:has_function`; current state: latest = current role set.

`readLog` does one container `GET`, lists `ldp:contains`, `GET`s + parses each child
(skipping unreadable/malformed; 404 → empty), classifies by `rdf:type`, then
`latestByAgent` keeps the newest event per WebID by `as:published`:

- `getMyMembership(room)` → latest membership is `as:Join`.
- `getMyRole(room)` → latest `as:Update`'s functions.
- `getMembers(room)` → agents whose latest membership is `as:Join`, annotated with
  their latest roles (membership, not having a role, defines a member).
- `getMembersByRole(room, role)` → members currently holding `role`.

**Ordering caveat:** `as:published` is a client clock (per-agent, last-writer-wins).
Documented hardening: order by each event's server `Last-Modified` (tie-break on URL).

## UI flow

- **Create** — `createRoom`: write container + ACL, then `enterRoom` (bookmark, join,
  make current — leaving any previous room).
- **Add** — `addKnownRoom` (from pasting a URI or scanning a QR): validate
  (`roomExists`) and **bookmark only** — does *not* join. Click the bookmark to enter.
- **Enter** — clicking a bookmark → `openRoom` → `enterRoom`: leave the room you're in,
  `as:Join` this one, ensure it's bookmarked, set it current.
- **Leave** — `exitRoom`: `as:Leave`, clear the current pointer; the **bookmark stays**.
- **Delete** — `deleteRoom` (owner only, via `ownsRoom`): delete the room's events,
  ACL, and container, then `removeKnownRoom` to forget the bookmark.

State is re-derived from the Pod on every read, so the current room and the bookmark
list survive restarts.

## Admission & trust

Open self-enrollment is an **ACL property of the container**, not app logic; restrict
by narrowing the ACL (out-of-band). The log is member-writable, so `as:actor` is a
**claim** the app sets to `session.info.webId` but cannot enforce — acceptable while
roles are low-stakes; gate admission if a role ever gates real data.

## Relationship to sharing

Membership and roles grant **no data access** by themselves. A room is only a
**directory**: `getMembersByRole` resolves a role to WebIDs, which the "share by role"
UI feeds into ordinary per-resource grants. The actual access is bilateral and
room-independent — see [sharing.md](sharing.md).

## Tests

Offline tests in [`dataRoom_test.ts`](src/services/interop/dataRoom_test.ts)
(`deno task test`): latest-wins folding, concurrent members not clobbering, the two
axes independent, join→leave, role-without-join ≠ member, role→WebID resolution,
`createRoom` (bookmark + current + single membership), `addKnownRoom` bookmark-without-join
vs `enterRoom`, leaving keeps the bookmark / `removeKnownRoom` forgets it, `roomExists`,
`ownsRoom`, and `deleteRoom`.
