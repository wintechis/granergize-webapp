# Data Rooms (a WebID directory)

A data room is an **append-only LDP container** any user creates on their own Pod.
State is **event-sourced**: join and leave each append one immutable event; current
state is **derived on read** by folding (latest event per WebID). This gives an audit
trail and avoids lost-update races.

Companion to [`sharing.md`](./sharing.md): a room grants no access on its own — it is
a recipient *directory*. Its whole job is to answer the question that otherwise
blocks every share: **whom do I share with, and what is their WebID?** The room page
lists each member's name and WebID (copyable); the share dialog's recipient field
offers those members alongside your contacts. The grant that follows is an ordinary
bilateral WebID grant — nothing room-shaped reaches the service layer or the event.

**Single room at a time:** you are a member of at most one room — the *current*
room; entering another leaves it. A persistent **bookmarks** list lets you switch
between rooms you know about.

**One axis: membership.** Rooms once carried a second, independent axis — self-assigned
**roles** — so a share could target "everyone holding role X". That was the app's only
remaining role concept, and it went with the feature: there is no `UserRole` type any
more, and the model is fully **user-centric**, every event and every grant keyed on a
**WebID**. Legacy `as:Update`/`sioc:has_function` events on an existing Pod are simply
skipped by the fold — no migration, no rewrite. The role IRIs stay published in
`vocab/vocab.ttl` so old logs remain resolvable.

## Storage

- **Identity = container URI**, e.g. `https://alice.example/granergize/rooms/<uuid>/`
  (`createRoom`).
- **ACL**: creator `acl:Control`; any authenticated agent `acl:Read` + `acl:Append`
  (open self-enrollment). No central room — share the URI/QR so others can join.
- Appends via **LDP container `POST`** (server mints each child URI); the Pod applies
  no SPARQL `PATCH`.

For where these files sit in the Pod tree, see [storage-layout.md](storage-layout.md).

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

The registry is read through React Query (`useRooms` → `readRooms`) and written
authoritatively by the room mutations; `enterRoom`/`exitRoom` keep `prefs.ttl` (+
`bookmarks.ttl`) in sync. (An earlier in-memory mirror — `getActiveRoom`/
`hydrateActiveRoom` — was replaced by that query.)

## Events (Activity Streams 2.0)

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

*(Retired: an `as:Update` carrying `sioc:has_function` role IRIs was the second event
kind while rooms had roles. `classifyRoomEvent` no longer recognises it, so such an
event on an old Pod folds to nothing.)*

## Operations & fold

- **Join** — `joinRoom`; event `as:Join`; latest membership = `as:Join` → member.
- **Leave** — `leaveRoom`; event `as:Leave`; latest membership = `as:Leave` → not a member.

`readLog` does one container `GET`, lists `ldp:contains`, `GET`s + parses each child
(skipping unreadable/malformed; 404 → empty), classifies by `rdf:type`, then
`latestByAgent` keeps the newest event per WebID by `as:published`:

- `getMyMembership(room)` → latest membership is `as:Join`.
- `getMembers(room)` → agents whose latest membership is `as:Join` — the directory,
  each entry just a WebID.
- `getRoomLogState(room)` → both of the above from ONE `readLog` (what `useRoomState`
  calls, so a room page folds the log once).

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
**claim** the app sets to the caller's `gateway.webId` but cannot enforce. That is
acceptable precisely because membership gates nothing: a forged `as:actor` puts a
wrong name in a directory, it grants no access. Gate admission (narrow the ACL) if
membership ever comes to mean more than "findable".

## Relationship to sharing

Membership grants **no data access**. A room is only a **directory**: you read a
member's WebID off the room page (or pick them in the share dialog's recipient field,
which merges room members with your contacts) and share with that person. The access
itself is bilateral and room-independent — see [sharing.md](sharing.md). Nothing in
`services/interop/share.ts` or the `shared-out/` event mentions a room.

## Tests

Offline tests in `dataRoom.test.ts`
(`deno task unit:local`): latest-wins folding, concurrent joins not clobbering,
join→leave, a legacy role event folding to nothing,
`createRoom` (bookmark + current + single membership), `addKnownRoom` bookmark-without-join
vs `enterRoom`, leaving keeps the bookmark / `removeKnownRoom` forgets it, `roomExists`,
`ownsRoom`, and `deleteRoom`.
