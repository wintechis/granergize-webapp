# Storage model — container-native, event-log state

How app data is laid out on the Pod and why. Companion to
[`data-layout.md`](./data-layout.md) (the full directory tree). All app data lives
under `<storageRoot>granergize/`; paths derive in `solidUtils.ts` (`podResources`).

The model separates three concerns the design deliberately keeps apart:
*enforcement* (the WAC `.acl`), *history* (append-only event logs), and *personal
state* (small single-writer flat files). There is no registry/index layer — own
resources are found by listing their container.

## Principles

- **Own data → list the container.** `buildings/`, `rooms/`, `views/`. Adding a
  resource is a single PUT/POST, so there is no separate index to desync from the
  listing.
- **Temporal / membership state → an append-only event-log container.** One resource
  per event (grant, revoke, join, leave, role-change), POSTed to the container
  (race-free). Past events are never edited or deleted; "current" state is the fold
  of the log.
- **Access enforcement → the WAC `.acl`.** Server-enforced truth for who can read
  *now*. The logs are the app's record/history, not the enforcement.
- **Personal low-contention state → one small flat file** (`prefs.ttl`,
  `bookmarks.ttl`). Single writer (you), so read-modify-write is safe.
- **Naming.** Resource **paths** are lowercase / kebab-case (`shared-in/`,
  `views/snapshots/`, `prefs.ttl`). camelCase appears only in `gran:` vocab term
  local-names (`gran:hiddenBuilding`, `gran:currentRoom`), which is RDF-conventional.

## Layout (`<storageRoot>granergize/`)

- **`buildings/`** — your buildings, one TTL each; per-building energy under
  `buildings/<id>/…`. Discovery = list, take top-level `*.ttl`, skip the energy
  subcontainers. Provenance is inside each file (PROV).
- **`rooms/`** — rooms you **host**; each carries its own Activity-Streams membership
  event log (`as:Join` / `as:Leave` / role `as:Update`). Discovered by listing.
- **`views/`** — aggregated views, container-native: one definition per resource,
  `views/<view-id>.ttl`, discovered by listing (skip `snapshots/`, same filter as
  `buildings/`). Shareable computed copies live in `views/snapshots/<view-id>.ttl`.
  `<view-id>` is the opaque `view-<ts>-<rand>` slug (rename-safe, collision-free).
- **`shared-in/`** — append-only log of sharing **received**: grant/revocation events
  archived from the inbox, each pointing at a building/view URI on another Pod. The
  one local record that is genuinely necessary — an inbound grant lives in the *other*
  Pod's `.acl` and is only learned via the inbox, so it can't be discovered from your
  own containers. "Shared with me, now" = fold the log.
- **`shared-out/`** — append-only log of sharing **performed**. The temporal/audit
  record ("shared to B on T1, revoked on T2"), which WAC cannot express since the
  `.acl` has no memory. The `.acl` stays the enforcement truth.
- **`prefs.ttl`** — personal state: active room (`gran:currentRoom`), hidden buildings
  (`gran:hiddenBuilding`), room for future UI prefs. Single writer.
- **`bookmarks.ttl`** — external room URIs you've joined (`gran:knownRoom`). Kept
  separate from `prefs.ttl`; both are single-writer, low-contention.
- **inbox** (`ldp:inbox`) — transient grant/revocation delivery, processed into
  `shared-in/`.

`shared-in/` and `shared-out/` are symmetric full append-only logs; current state is
grants minus revocations.

**View sharing is the building case.** A shared view is its computed snapshot — a
privacy-preserving copy (buildingCount + values, no building URIs). Sharing it = an
`.acl` grant on the snapshot resource + a `shared-out/` event, exactly like a
building. No extra state the ACL can't hold.

## Why client-chosen URIs + PUT (not POST/`Location`)

Addressable resources and containers are created by **PUT to a URI the client picks**,
not by POST-to-a-container letting the server mint a slug. The reasons, since this
recurs:

- **Named structural folders must be PUT.** "Create this folder if absent" is only
  expressible as PUT to that exact URI (GET → if 404, PUT). POST always makes a *new*
  child; it can't target a fixed path.
- **Leaf items (buildings, rooms) are PUT by choice, for idempotency under the retry
  layer — the load-bearing reason.** Every Pod write goes through `retryFetch`, which
  replays on Cloudflare 429/503 and dropped connections. A PUT to a fixed URI is
  replay-safe (a retry hits the same URI; `If-None-Match: *` turns the duplicate into
  a clean 412). A POST is not — the server mints a fresh slug per call, so "request
  landed but the 201 was lost → retry" silently creates a second resource. On flaky
  throttled Pods (our environment) that matters; LDP's idempotent-create primitive
  *is* `PUT … If-None-Match: *`, and POST has no equivalent.
- **Derived paths up front.** Knowing the id before writing lets one flow compute
  everything keyed off it (a building's certificates / energy datasets, a room's
  `.acl` + first join event) with no "POST, await, parse `Location`, derive" round-trip.
- **Cross-server uniformity.** PUT-to-URI behaves identically across NSS / CSS v5–v7;
  POST `Slug`/`Location` semantics vary.

**POST is used only for append-only event logs** (`shared-out/`, `shared-in/`, a
room's `as:Join`/`as:Update`), where a unique server-minted child per append is
exactly what's wanted and a retry duplicate folds away harmlessly. Rule of thumb:
resources you must *address later* get client URIs; resources you only *accumulate*
get POST. (Making POST idempotent for server-assigned URIs would require either server
support CSS/NSS lack, or a client dedup-token + list-and-reconcile guard — strictly
more machinery than `PUT <uuid> If-None-Match: *` to gain only a cosmetic `Location`.)

## Turtle shapes

Existing vocabularies only: `interop:` for the access relationship, `prov:` for actor
+ time (uniform across grant/revoke, consistent with building provenance), `acl:` for
the mode, `gran:` for app bits. One event per resource, subject `<>` (the resource
*is* the event).

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

The same shape serves the inbox message, `shared-out/`, and `shared-in/`; only the
roles differ. In `shared-out/`, `prov:wasAssociatedWith` = me and `interop:forResource`
= *my* resource; in `shared-in/` (archived from the inbox) it's the external owner and
*their* resource on another Pod. `gran:kind` (`gran:Building` | `gran:View`) routes the
recipient to the right loader without a probe fetch; an optional
`interop:includesEnergyData "true"^^xsd:boolean` is a hint only — actual energy access
is whatever the owner's `.acl` allows. The shape is flat (`interop:forResource` +
`prov:wasAssociatedWith`/`generatedAtTime`) rather than the nested
`interop:hasDataGrant [ interop:DataGrant … ]` wrapper — simpler to fold.

**Fold to current state.** Group events by `(interop:grantee, interop:forResource)`,
take the max `prov:generatedAtTime`; the pair is active iff the latest event is an
`interop:AccessGrant`. A revocation wins on an exact timestamp tie (least-privilege;
deterministic for a rapid grant→revoke). For `shared-in/` the grantee is always me, so
it reduces to group-by-`forResource`.

```turtle
# prefs.ttl — single subject <>
<> a gran:Preferences ;
   gran:currentRoom    <https://me.example/granergize/rooms/9f3a1c> ;   # 0 or 1
   gran:hiddenBuilding <https://alice.example/granergize/buildings/x.ttl#x> ;  # 0..n
   gran:lastTab        "manage" .   # example future UI pref; extensible

# bookmarks.ttl — external rooms you've joined
<> a gran:Bookmarks ;
   gran:knownRoom <https://carol.example/granergize/rooms/abc> .   # 0..n external
```

## State has two sources, by design

- **Outgoing** — current "shared with whom" reads from the `.acl` (you can read your
  own ACLs); `shared-out/` is the history/audit. The Manage "Shared with" badge reads
  the `.acl` (N acl-GETs, parallelizable).
- **Incoming** — there is no cheaper authority than your own record, so "shared with
  me" = fold the `shared-in/` log. Enforcement is checked lazily by the load itself: a
  building whose grant was revoked `403`s on fetch and is pruned as inaccessible, so a
  missed revocation self-heals on the next load.

Discovery is N+1 reads (list a container, then GET each member) rather than one
registry read, but the GETs parallelize and it's fine for realistic counts; add a
cache only if a collection grows large.
