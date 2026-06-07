# Storage redesign — container-native, event-log state

> **Status: DRAFT — refining.** Captures the target Pod layout before any code.
> Once settled, this drives the implementation.

## Why

Today several flat **registry files** sit under `granergize/`
(`dataSources.ttl`, `rooms.ttl`, `sharingRegistry.ttl`,
`views/viewSharingRegistry.ttl`, `hiddenBuildings.ttl`). Two problems:

- **Duplication.** They mirror information already available elsewhere — your own
  resources are discoverable by **listing a container** (LDP `ldp:contains`), and
  "who can read X right now" is already in X's **WAC `.acl`**. The recent move of
  building provenance into the building file (PROV qualified attribution) removed the
  last per-own-building metadata the registry carried, so own-building entries are now
  *pure* duplication of the `buildings/` listing.
- **Race-prone writes.** Mutable registries are updated with read-modify-write
  (PUT, since the server ignores PATCH — PUT/POST only). Two
  concurrent writers (e.g. inbound grants) can lose updates.

Goal: **one discovery model** (list a container), **race-free appends** (LDP POST),
and a clean separation of three concerns that the old registries conflated —
*enforcement* (ACL), *history* (event logs), and *personal state* (small flat files).

## Principles

- **Own data → list the container.** `buildings/`, `rooms/`, `views/`. No registry
  mirror; adding a resource is a single PUT/POST, so container and registry can't
  desync.
- **Temporal / membership state → an append-only event-log container.** One resource
  per event (grant, revoke, join, leave, role-change), POSTed to the container
  (race-free). History is preserved; "current" state = fold the log. Never edit or
  delete past events.
- **Access enforcement → the WAC `.acl`.** The server-enforced source of truth for who
  can read *now*. Logs are the app's record/history, not the enforcement.
- **Personal low-contention state → one small flat file** (`prefs.ttl`). Only you
  write it, so read-modify-write is fine.
- **Naming.** All resource **paths** are lowercase / kebab-case (`shared-in/`,
  `views/snapshots/`, `prefs.ttl`). camelCase appears only in `gran:` **vocab term
  local-names** (`gran:hiddenBuilding`, `gran:currentRoom`, …), which is RDF-
  conventional and stays as-is (the `gran:` vocab is external).

## Resource creation: client-chosen URIs + PUT (not POST/`Location`)

Every resource and container is created by **PUT to a URI the client picks**, never
by POST-to-a-container letting the server mint a slug and hand it back in `Location`.
This is deliberate; the reasoning, since it recurs:

- **Named structural folders *must* be PUT.** `buildings/`, `inbox/`, `views/`, the
  `rooms/` parent — "create this folder if absent" is only expressible as PUT to that
  exact URI (GET → if 404, PUT). POST always makes a *new* child; it can't say "at
  this path." So for fixed paths there is no choice.
- **Leaf items are client-id'd by *choice*, not necessity.** A building (`buildings/
  <id>.ttl`, id = `Date.now()-rand`) or a room (`rooms/<uuid>/`, `crypto.randomUUID`)
  *could* be POSTed — their ids are opaque, nothing constructs paths from a room id.
  We still PUT them, for:
  - **Idempotency under the retry layer (the load-bearing reason).** Every Pod write
    goes through `retryFetch`, which replays on Cloudflare 429/503 and on connection
    aborts the caller didn't request. A **PUT to a fixed URI is replay-safe** — a
    retry after a lost response hits the *same* URI, so you get one resource (and
    `If-None-Match: *` makes the duplicate attempt a clean 412). A **POST is not** —
    the server mints a fresh slug per call, so "request landed but the 201 was lost →
    retry" silently creates a *second* room/building. On flaky throttled Pods (exactly
    our environment) that matters. LDP's built-in idempotent-create primitive *is*
    `PUT … If-None-Match: *`; POST has no equivalent.
  - **Derived paths up front.** Knowing the id before writing lets one flow compute
    everything keyed off it — a building's `certificates/<id>_…` / energy datasets, a
    room's `.acl` + first join event — with no "POST, await, parse `Location`, derive"
    round-trip.
  - **Cross-server uniformity.** PUT-to-URI behaves identically on NSS / CSS v5–v7;
    POST `Slug`/`Link`-type/`Location` semantics vary. PUT is the lowest common
    denominator, and we target all four.
- **POST is used where it's right: append-only event logs.** Membership/sharing events
  (`shared-out/`, `shared-in/`, a room's `as:Join`/`as:Update`) POST into the container
  *because* you want a unique server-minted child per append and don't care what it's
  named — and a duplicate from a retry folds away harmlessly. Resources you must
  *address later* get client URIs; resources you only *accumulate* get POST.

**Could we make POST idempotent (to get server-assigned URLs)?** Yes, but it's a net
loss here:
- *Server idempotency key* (`Idempotency-Key` header, Stripe-style) — needs server
  support CSS/NSS don't have; only works on a Pod you control. Out.
- *`Slug` + conditional* — `Slug` isn't conditional (servers append `-1` on collision
  rather than failing), so it can't dedupe a retry. The only "create-at-name-or-fail"
  is `PUT … If-None-Match: *` — i.e. it collapses into the current design.
- *Client dedup-token + reconcile* (the one that actually works server-agnostically) —
  embed a client token in the POSTed body; on an *ambiguous* failure don't re-POST but
  **list the container and look for that token**, adopting the existing child if found.
  This is real, but it reintroduces a client-generated id (the token), adds a
  list+scan round-trip per ambiguous retry, and forces `retryFetch` to become
  method-aware (stop blind-replaying POSTs — which also touches the event-log POSTs).
  That's strictly more machinery than `PUT <uuid> If-None-Match: *`, whose exactly-once
  guarantee is free, to gain only a cosmetic `Location`. The degenerate robust form of
  this guard is "mint the id client-side and PUT it" — which closes the loop.

**Decision:** client-chosen URI + PUT for addressable resources/containers; POST only
for accumulate-only event logs. Revisit only if we move to a controlled Pod and want
canonical REST semantics enough to pay for the dedup-token + reconcile path.

## Target layout (`<storageRoot>granergize/`)

- **`buildings/`** — your buildings (one TTL each; per-building energy under
  `buildings/<id>/…`). Discovery = list, take top-level `*.ttl`, skip the energy
  subcontainers. Provenance is inside each file (PROV).
- **`rooms/`** — rooms you **host**; each room already carries its Activity-Streams
  membership event log (`as:Join` / `as:Leave` / role `as:Update`) — i.e. it is
  already event-log style. Hosted rooms are discovered by listing, not duplicated in a
  registry.
- **`views/`** — your aggregated views, **container-native** (drops the old
  `viewDefinitions.ttl` mega-file): one definition resource per view,
  `views/<view-id>.ttl`, discovered by listing (skip the `snapshots/` subfolder, same
  filter as `buildings/`). The shareable computed copies live in
  **`views/snapshots/<view-id>.ttl`** (was `views/computed/`). `<view-id>` stays the
  opaque `view-<ts>-<rand>` slug (rename-safe, collision-free).
- **`shared-in/`** — append-only log of sharing **received**: grant/revocation events
  copied out of the inbox, each pointing at an external building/view URI on another
  Pod. This is the one local record that is genuinely necessary — an inbound grant
  lives in the *other* Pod's `.acl` and is only learned via the inbox, so it can't be
  discovered from your own containers. "Shared with me, now" = fold the log.
- **`shared-out/`** — append-only log of sharing **performed**: grant/revocation events
  with timestamps. History / audit ("shared to B on T1, revoked on T2") — which the
  ACL cannot express, since WAC has no memory. The `.acl` stays the enforcement truth;
  this is the temporal record.
- **`prefs.ttl`** — your personal state: active room (`currentRoom`), hidden buildings
  (`gran:hiddenBuilding`), and room for future UI prefs (last tab, default view,
  theme…). Single writer (you).
- **`bookmarks.ttl`** — external room URIs you've joined (rooms hosted by others). A
  separate flat file from `prefs.ttl` (single writer; low contention).
- **inbox** (`ldp:inbox`) — unchanged: transient grant/revocation delivery, processed
  into `shared-in/`.

Both `shared-in/` and `shared-out/` are **full append-only event logs** (symmetric);
current state is derived by folding grants minus revocations.

## What goes away

- `dataSources.ttl` → own buildings via `buildings/` listing; shared-in via
  `shared-in/`.
- `rooms.ttl` → hosted via `rooms/`; active room → `prefs.ttl`; external rooms →
  `bookmarks.ttl`.
- `sharingRegistry.ttl` + `views/viewSharingRegistry.ttl` → `shared-out/` (history) +
  the `.acl` (current).
- `hiddenBuildings.ttl` → folded into `prefs.ttl`.

**View sharing is the building case.** A shared view is its **computed snapshot** — a
privacy-preserving *copy* made at compute time (`views/computed/…`: buildingCount +
values, no building URIs). Sharing it = grant `.acl` on the snapshot resource + a
`shared-out/` event, exactly like a building. No extra state the ACL can't hold.

## Turtle shapes

Reuse existing vocabularies — nothing new: `interop:`
(`http://www.w3.org/ns/solid/interop#`) for the access relationship, `prov:` for the
actor + time (uniform across grant/revoke, consistent with building provenance),
`acl:` for the mode, `gran:` for app bits. One **event per resource**, subject `<>`
(the resource *is* the event). **Append = POST to the container; never edit/delete.**

### Sharing event (one shape for inbox message, `shared-out/`, `shared-in/`)

```turtle
@prefix interop: <http://www.w3.org/ns/solid/interop#> .
@prefix prov:    <http://www.w3.org/ns/prov#> .
@prefix acl:     <http://www.w3.org/ns/auth/acl#> .
@prefix gran:    <https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#> .
@prefix xsd:     <http://www.w3.org/2001/XMLSchema#> .

# GRANT — e.g. …/granergize/shared-out/01J….ttl
<> a interop:AccessGrant ;
   prov:wasAssociatedWith <https://owner.example/profile/card#me> ;   # the sharer
   interop:grantee        <https://bob.example/profile/card#me> ;     # recipient
   interop:forResource    <https://owner.example/granergize/buildings/b-1.ttl#b-1> ;
   interop:accessMode     acl:Read ;
   gran:kind              gran:Building ;        # routing hint: Building | View
   prov:generatedAtTime   "2026-06-04T10:15:00Z"^^xsd:dateTime .

# REVOCATION — same (grantee, forResource), later. No accessMode/kind needed.
<> a interop:AccessRevocation ;
   prov:wasAssociatedWith <https://owner.example/profile/card#me> ;
   interop:grantee        <https://bob.example/profile/card#me> ;
   interop:forResource    <https://owner.example/granergize/buildings/b-1.ttl#b-1> ;
   prov:generatedAtTime   "2026-06-10T09:00:00Z"^^xsd:dateTime .
```

- **`shared-out/`** (my outgoing record): `prov:wasAssociatedWith` = me,
  `interop:grantee` = recipient, `interop:forResource` = *my* resource.
- **`shared-in/`** (my inbound record, archived from the inbox): `prov:wasAssociatedWith`
  = the external owner, `interop:grantee` = me, `interop:forResource` = *their*
  resource (another Pod).
- `gran:kind` routes the recipient to the building vs view loader without a probe fetch
  (`gran:Building` | `gran:View`). Optional `interop:includesEnergyData
  "true"^^xsd:boolean` on a grant is a hint only — energy access is whatever the
  owner's `.acl` actually allows.

Note this drops the old nested `interop:hasDataGrant [ interop:DataGrant … ]` wrapper
and the `interop:grantedBy`/`grantedAt` pair in favour of flat `interop:forResource` +
`prov:wasAssociatedWith`/`generatedAtTime` — simpler to fold, and the wire format
changes freely since there's no migration.

**Fold to current state.** Group events by `(interop:grantee, interop:forResource)`,
take the max `prov:generatedAtTime`; the pair is active iff that latest event is an
`interop:AccessGrant`. For `shared-in/` the grantee is always me, so it's effectively
group-by-`forResource`. (`shared-out/` is folded only for the audit view — current
"shared with" reads the `.acl`.)

### `prefs.ttl` (single subject `<>`)

```turtle
@prefix gran: <https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#> .

<> a gran:Preferences ;
   gran:currentRoom    <https://me.example/granergize/rooms/9f3a1c> ;   # 0 or 1
   gran:hiddenBuilding <https://alice.example/granergize/buildings/x.ttl#x> ,
                       <https://bob.example/granergize/buildings/y.ttl#y> ;  # 0..n
   gran:lastTab        "manage" .   # example future UI pref; extensible
```

### `bookmarks.ttl` (external rooms you've joined)

```turtle
@prefix gran: <https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#> .

<> a gran:Bookmarks ;
   gran:knownRoom <https://carol.example/granergize/rooms/abc> ,
                  <https://dave.example/granergize/rooms/xyz> .   # 0..n external
```

`gran:currentRoom` / `gran:knownRoom` / `gran:hiddenBuilding` are the predicates
already in use today (in `rooms.ttl` / `hiddenBuildings.ttl`), just relocated.

## Costs / trade-offs

- **N+1 reads.** Discovery lists a container, then GETs each member. vs one registry
  read today. Parallelizable, fine for realistic counts; add a cache only if a
  collection grows large.
- **Current state, two sources (decided):**
  - *Outgoing* — the `.acl` is authoritative for "shared with whom, now" (you can read
    your own ACLs); `shared-out/` is the history/audit. The Manage "Shared with" badge
    reads the `.acl` (N acl-GETs, parallelizable).
  - *Incoming* — there is no cheaper authority than your own record, so "shared with
    me" = **fold the `shared-in/` log**. Enforcement is checked lazily by the load
    itself: a building whose grant was revoked `403`s on fetch and is pruned as an
    inaccessible source, so a missed revocation **self-heals on next load**.

## Migration / back-compat

**None.** Existing (dev/demo) Pods are wiped via `removeAppData` and re-bootstrapped
straight into the new layout. So:

- No read-fallback, no dual-read paths — the new layout is the *only* layout the code
  knows. Simpler implementation everywhere.
- The recently-shipped PROV legacy fallback (reading `gran:dataSourceRole` from
  `dataSources.ttl` when a building file lacks a `prov:qualifiedAttribution`) becomes
  dead once `dataSources.ttl` is gone — drop it as part of this work.
- `removeAppData` must be updated to wipe the new resource set
  (`buildings/`, `rooms/`, `views/`, `shared-in/`, `shared-out/`, `prefs.ttl`,
  `bookmarks.ttl`, inbox) and the bootstrap to create the new empties.

## Decisions (settled)

1. **Bookmarks** → separate `bookmarks.ttl` (not folded into `prefs.ttl`).
2. **`shared-in/` and `shared-out/`** → both **full append-only event logs**; current
   state folded from the events.
3. **Current state** → outgoing from the `.acl`; incoming by folding `shared-in/`, with
   the load's `403`-pruning as the lazy enforcement check (missed revocations
   self-heal). `shared-out/` and `shared-in/` keep history/audit.
4. **View sharing** = building sharing on the computed snapshot copy; no extra state.
5. **Container discovery** → `ldp:contains`, reusing `listContainedResources`
   (`podDelete.ts`).
6. **Migration** → none; wipe the Pod (`removeAppData`) and re-bootstrap into the new
   layout. No fallbacks; drop the now-dead PROV `gran:dataSourceRole` fallback.
7. **Views** → container-native: `views/<view-id>.ttl` (definitions, one per resource)
   + `views/snapshots/<view-id>.ttl` (shareable copies); opaque `view-<ts>-<rand>` ids.
8. **Naming** → lowercase/kebab resource paths; camelCase only in `gran:` vocab terms
   (RDF-conventional, unchanged).

## Implementation order

Suggested sequence (no fallbacks, so each step replaces the old reads/writes outright;
wipe + re-bootstrap the test Pod between steps):

1. **`prefs.ttl` + `bookmarks.ttl`** — smallest, no discovery change. Move
   `hiddenBuildings.ttl` → `prefs.ttl`, split `rooms.ttl` (active → `prefs.ttl`,
   external → `bookmarks.ttl`, hosted → drop). **DONE.**
2. **Container-native own data** — discover `buildings/` by listing (new
   `listDirectChildren` in `podDelete.ts` — `null` on a missing container vs `[]`
   empty; a fresh Pod is *offered* the demo buildings via a banner rather than
   silently seeded, with the decline persisted in `prefs.ttl` `gran:demoSeedDeclined`),
   drop the own-building registry
   writes (`add/removeBuildingFromRegistry`) and the dead `gran:dataSourceRole` PROV
   fallback; drop the unused agents data source; `views/` becomes
   one-resource-per-definition (`views/<id>.ttl`, list to discover) +
   `views/snapshots/<id>.ttl`. **DONE.**
3. **`shared-in/` / `shared-out/`** — the sharing rewrite: one event shape
   (`sharingLog.ts`: `buildSharingEventTurtle` / `parseSharingEvents` /
   `appendSharingEvent` / `foldSharingLog`) for the inbox message + both logs.
   `getSharedWithMe` and `listSharedBuildingSources` fold `shared-in/`;
   `getSharedBuildings` / `getSharedViews` fold `shared-out/`; `revokeAccess` /
   `revokeViewAccess` append a revocation; the inbox archives each message into
   `shared-in/`. Removed `dataSources.ttl`, `sharingRegistry.ttl`,
   `viewSharingRegistry.ttl` (and `registryUrl`); `podResources` now exposes
   `sharedIn` / `sharedOut`. Fold tie-break: a revocation wins on an exact
   timestamp tie (least-privilege; deterministic for a rapid grant→revoke).
   **DONE.**
4. **`removeAppData` + bootstrap** — already covered: `removeAppData` recursively
   wipes the whole `granergize/` container (so it spans the new layout), and every
   resource is lazily created (demo buildings on a fresh `buildings/`; prefs /
   bookmarks / shared-in / shared-out / views on first write). No dedicated
   bootstrap step or registry pre-creation remains. **DONE.**

**Deviation note (step 3 supersedes the step-2 refinement):** the step-2 stopgap
where `dataSources.ttl` lingered as a shared-only registry is gone — `shared-in/`
now fully owns received shares, and `dataSources.ttl` is removed. Outgoing "shared
with" is derived by folding `shared-out/` (not by reading each `.acl` as decision #3
first proposed) — uniform with incoming and cheaper; the `.acl` remains the
enforcement truth and the app is the only writer, so the fold matches it.

**Refinement made during step 2 (intentional deviation):** `dataSources.ttl` is *not*
deleted in step 2 — only the **own-building** entries stop being written there (own
buildings are now found by listing `buildings/`). The file lives on holding **only the
shared-in** sources the inbox records, read by `loadBuildingsAndAgents`
(`listSharedBuildingSources`) and `getSharedWithMe`, so received shares keep working
after a step-2 wipe. Step 3 moves that record to `shared-in/` and removes
`dataSources.ttl` outright. (The end state is unchanged; this just keeps each step
shippable rather than breaking shared-building discovery between steps 2 and 3.)

The Turtle shapes above are settled; nothing else blocks implementation.
