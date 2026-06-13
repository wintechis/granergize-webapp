# Data Rooms (membership & roles)

A data room is an **append-only LDP container** any user creates on their own Pod.
State is **event-sourced**: join, leave, and role changes each append one immutable
event; current state is **derived on read** by folding (latest event per WebID, per
axis). This gives an audit trail and avoids lost-update races.

Companion to [`sharing.md`](./sharing.md): a room grants no access on its own — it's a
recipient *directory* that sharing reads.

**Single room at a time:** you are a member of at most one room — the *current*
room; entering another leaves it. A persistent **bookmarks** list lets you switch
between rooms you know about.

Two **independent axes**: **membership** (in the room or not) and **role(s) held**.
You can be a member with no role, or have left while role history remains.

The data-room membership role is the **only role concept the app uses** — the former
company-kind (organisation `org:classification`) and building producing-role (PROV
`prov:hadRole`) no longer drive anything. The model is **user-centric**: every event,
and every grant sharing produces, is keyed on the member's **WebID**. A role is read as
**the role of the organisation the user represents** — the user is the authenticating
identity, but the role belongs to their org (taken from the WebID profile's
`org:memberOf`). "Alice holds the investor role here" means *Alice's organisation
participates as the investor, with Alice as its representative*.

## Storage

- **Identity = container URI**, e.g. `https://alice.example/granergize/rooms/<uuid>/`
  (`createRoom`).
- **ACL**: creator `acl:Control`; any authenticated agent `acl:Read` + `acl:Append`
  (open self-enrollment). No central room — share the URI/QR so others can join.
- Appends via **LDP container `POST`** (server mints each child URI); the Pod applies
  no SPARQL `PATCH`.

For where these files sit in the Pod tree, see [data-layout.md](data-layout.md).

### Room state on your Pod (no localStorage)

Your **own** Pod is the source of truth for both the list and the current room (so
they survive reloads and work across devices), split across two single-writer flat
files (you alone write each, so read-modify-write is safe):

- `…/granergize/prefs.ttl` (`prefs.ts`) — `<prefs> gran:currentRoom <iri>` is the
  **one room you're in** (0 or 1). Written by `setCurrentRoom`, read by `readPrefs`.
  (Also holds other personal UI prefs — hidden buildings, demo-seed dismissal.)
- `…/granergize/bookmarks.ttl` (`bookmarks.ts`) — `<bookmarks> gran:knownRoom <iri> …`
  is your **bookmarks** ("Your rooms"). Added by create / add-URI / scan via
  `addKnownRoom`; removed by `removeKnownRoom`; read by `readBookmarks`. They
  **survive leaving**.

(Rooms you *host* are discovered by listing `rooms/`, not duplicated in these files;
each hosted room's event log still lives under `rooms/<uuid>/`.)

`getActiveRoom()` reads an in-memory mirror of `currentRoom` (so components like the
sharing dialogs can read it synchronously); `hydrateActiveRoom` loads it from
`prefs.ttl` on login, and `enterRoom`/`exitRoom` keep `prefs.ttl` (+ `bookmarks.ttl`)
and the mirror in sync.

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

Role IRIs (`MEMBERSHIP_ROLE_TO_IRI`): `investor`→`gran:InvestorRole`, `user`→
`gran:UserRoleInstance`, `benchmark_service_provider`→`gran:BenchmarkRole`, and so on
for the remaining self-assignable roles. (`dummy`→`gran:DummyRole` is an internal
placeholder, not user-selectable.)

## Operations & fold

- **Join** — `joinRoom`; event `as:Join`; latest membership = `as:Join` → member.
- **Leave** — `leaveRoom`; event `as:Leave`; latest membership = `as:Leave` → not a member.
- **Set role(s)** — `setMyRole`; event `as:Update` + `sioc:has_function`; latest = current role set.

`readLog` does one container `GET`, lists `ldp:contains`, `GET`s + parses each child
(skipping unreadable/malformed; 404 → empty), classifies by `rdf:type`, then
`latestByAgent` keeps the newest event per WebID by `as:published`:

- `getMyMembership(room)` → latest membership is `as:Join`.
- `getMyRole(room)` → latest `as:Update`'s functions.
- `getMembers(room)` → agents whose latest membership is `as:Join`, annotated with
  their latest roles (membership, not having a role, defines a member).
- `getMembersByRole(room, role)` → members currently holding `role`.

**Ordering caveat:** `as:published` is a client clock (per-agent, last-writer-wins).
Documented hardening: order by each event's server `Last-Modified` (tie-break on URI).

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

State is re-derived from the Pod on every read, so it survives restarts.

## Admission & trust

Open self-enrollment is an **ACL property of the container**, not app logic; restrict
by narrowing the ACL (out-of-band). The log is member-writable, so `as:actor` is a
**claim** the app sets to `session.info.webId` but cannot enforce — acceptable while
roles are low-stakes; gate admission if a role ever gates real data.

## Relationship to sharing

Membership and roles grant **no data access** by themselves. A room is only a
**directory**: `getMembersByRole` resolves a role to WebIDs, which the "share by role"
UI feeds into ordinary per-resource grants. The access itself is bilateral and
room-independent — see [sharing.md](sharing.md).

## Tests

Offline tests in `dataRoom.test.ts`
(`deno task test`): latest-wins folding, concurrent members not clobbering, the two
axes independent, join→leave, role-without-join ≠ member, role→WebID resolution,
`createRoom` (bookmark + current + single membership), `addKnownRoom` bookmark-without-join
vs `enterRoom`, leaving keeps the bookmark / `removeKnownRoom` forgets it, `roomExists`,
`ownsRoom`, and `deleteRoom`.
