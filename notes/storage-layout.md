# Storage layout — on the Pod (LDP)

The **storage layout** is how each entity's data is arranged as LDP resources on
the Pod — container vs. file vs. fragment, the partitioning of a thing into
resources, and which relationships are realised as containment vs. links — rooted
at the storage location discovered via `pim:storage`. Paths derive in
`src/services/pod/solidUtils.ts`. Writes are PUT/POST only (no PATCH);
cache-sensitive reads use `fetchFresh`.

## Schema and profiles

A **schema** — the shared RDFS vocabulary (`vocab/`, see
[`data-schema.md`](./data-schema.md)) — says what an entity *is*. It is reusable
and not app-specific. Around that schema the app keeps a set of **profiles**,
each its own application of the schema for one concern (the Linked-Data sense of
an *application profile*). The schema sits at the centre; the profiles dance
around it:

- **Resource profile** — how the entity lives as an LDP resource: container/file/
  fragment, partitioning, contained-vs-linked relationships, storage model, and
  addressing. **This document's concern** (with the storage model in
  [`queries-mutations.md`](./queries-mutations.md) and addressing in
  [`data-deref.md`](./data-deref.md)).
- **Presentation profile** — how an instance renders.
- **Action profile** — what you can do to it; the intents. See
  [`queries-mutations.md`](./queries-mutations.md).

("Lens" is loose prose for one of these profiles — the artifact is the profile.)

### The resource profile

Its facets — the storage-side decisions — are orthogonal but coupled:

- **Storage layout** — container/file/fragment, partitioning, contained-vs-linked
  relationships (the *Tree* below).
- **Storage model** — in-place resource vs. event-sourced log, and the projection
  discipline ([`queries-mutations.md`](./queries-mutations.md)).
- **Addressing** — how the resource is named and dereferenced
  ([`data-deref.md`](./data-deref.md)).

The couplings: a thing's volume/granularity drives its partitioning (an annual
figure inline, a 15-minute series split per day); a relationship is realised as
containment *or* a link (a building's attachment files hang in its `files/` subtree;
its energy datasets and agents are linked IRIs); the writer/concurrency situation picks the storage model
(single-writer files vs. multi-writer append-only logs). The *Tree* and
*Rationale* below record the current profiles; companion:
[`building-detail.md`](./building-detail.md) (what hangs off a building URI).

The partitioning shape is also the storage-side of the presentation profile's
**subordinate vs. first-class** distinction (the "has a page?" axis,
[`building-detail.md`](./building-detail.md)): a thing partitioned **within the
parent document** — a hash (fragment) URI (`<…/buildings/{id}.ttl#pv>`) or a blank
node, both fetched/PUT with the parent — or as a contained child renders
subordinate (no page); one linked as a standalone document the user navigates to is
first-class. Coupled but not identical — a resource can have its own URI (even a
linked, top-level one) yet stay subordinate (the energy observation collections under
`observations/`), and a subordinate fragment can be `owl:sameAs` a first-class resource
elsewhere (the PV-system node ≡ its MaStR Einheit).

## One root

The storage root is resolved **once at login** from `pim:storage` on the WebID
(`resolveStorageRoot(gateway)` in `solidUtils.ts`; throws if the profile declares
none — no string-munge fallback). All app data then hangs off a single
`<storageRoot>granergize/` tree via `podResources(webId)`, the one source of truth
for paths. The lone exception is the organisation logo, which is **profile** data
and stays under `profile/`.

## Tree

```
<storageRoot>/                                        ← pim:storage
├── profile/
│   ├── card  (#me, #org)                             the WebID document (see below)
│   └── logo.<ext>                                    organisation logo image (org is part of the profile)
└── granergize/                                       ← podResources(): the single app root
    ├── prefs.ttl                personal UI state: currentRoom, hiddenBuilding(s), demoSeedDeclined
    ├── bookmarks.ttl            gran:knownRoom — external room bookmarks ("Your rooms")
    ├── agents.ttl              vCard address book: saved agents + local annotations (kind, org fields, "works for")
    ├── agents/logos/<stem>.<ext>   referenced-org logos (vcard:logo, public-read; own-org logo is profile/logo.<ext>)
    ├── buildings/<uuid>.ttl     subject <…/buildings/<uuid>.ttl#it> (discovered by LISTING — no registry)
    ├── observations/            energy datasets — first-class, time-first (Phase-0 C2)
    │   ├── <year>/<id>.ttl      annual aggregate (inline obs) / PT15M series descriptor; <id> = UUID stem
    │   └── <year>/<month>/<day>/<id>.ttl   series daily 15-min reading files (same <id>, one level deeper)
    ├── aggregations/
    │   ├── <id>.ttl             one aggregation-definition resource (discovered by listing)
    │   └── snapshots/<id>.ttl   shareable computed snapshots
    ├── shared-out/<event>       append-only log: sharing performed (POST-minted child URIs)
    ├── shared-in/<event>        append-only log: sharing received (folded to "shared with me")
    ├── rooms/<uuid>             data rooms you HOST (append-only AS2/SIOC activity logs)
    └── inbox                    LDP inbox (sharing notifications)
```

No registries. Each list is derived from the Pod's own structure: own buildings,
observations, and aggregation definitions by **listing** their container; the active room, hidden
buildings, and demo-offer state from **`prefs.ttl`**; external room bookmarks from
**`bookmarks.ttl`**; what's shared in/out by **folding** the append-only event
logs (`shared-in/`, `shared-out/`). The old `dataSources.ttl` /
`sharingRegistry.ttl` / `views/viewSharingRegistry.ttl` /
`views/viewDefinitions.ttl` / `views/computed/` / `hiddenBuildings.ttl` /
`rooms.ttl` registries are gone (see *Rationale* below).

**Energy file layout.** Datasets are **first-class and time-first** under
`observations/` (not nested in a building's subtree). Each building links its datasets
with `cons:hasEnergyDataset` → `observations/{year}/<id>.ttl#ds` — the link is the
discovery path, and the year/granularity/scenario are **re-stated in the building file**
about each dataset node (read without fetching the dataset), since the opaque `<id>`
path no longer encodes them. An annual aggregate (`P1Y`) holds inline SOSA observations in
`observations/{year}/<id>.ttl`; a 15-minute series (`PT15M`) is a descriptor at the
same path plus per-day reading files at `observations/{year}/{month}/{day}/<id>.ttl`
(the **same** `<id>`). A reading bound to no building lives under `observations/`
unlinked. (Model: [`energy-model.md`](./energy-model.md); load phasing:
[`data-deref.md`](./data-deref.md).)

**Sharing logs (no registry).** `shared-out/` and `shared-in/` are symmetric,
append-only LDP containers, one resource per sharing *event* (a `POST` lets the
server mint each child URI, so concurrent appends never clobber). The WAC `.acl`
stays the enforcement truth; these logs are the app's *record* and the only way a
recipient learns of a grant. Event model and grant/revocation folding: see
[`sharing.md`](./sharing.md).

**Demo buildings (offered, not auto-seeded).** A fresh Pod (no `buildings/`
container at all) is *offered* the demos via a dismissible banner (`useDemoOffer`
in `queries.ts`); choosing "Add examples" calls `seedDemoBuildings(gateway, webId)`,
which writes four real, *user-owned* demo buildings through the normal pipeline (all
in Nürnberg, coordinates geocoded at seed time via Nominatim). The set spans every
loader shape and panel state a new user should see: **Nordostpark 84** — an inline
annual (`P1Y`) SOSA aggregate, self-operated, the full investor panel;
**Hafenstraße 12** — annual but *not* self-operated, so no investor panel;
**Lange Gasse 20** — *both* shapes (annual + a 15-minute `PT15M` series → the
Annual | Time series toggle); **Pirckheimerstraße 68** — a `PT15M` series only (no
annual, no toggle). Declining persists in `prefs.ttl` as `gran:demoSeedDeclined`,
so the banner doesn't nag on every login. Nothing is seeded silently.

Origins (all via `podResources(webId)` unless noted): prefs `prefs.ts`; bookmarks
`bookmarks.ts`; buildings/energy `buildingSerializer.ts`; own-building discovery +
shared-fold `turtleParsingService.ts`; aggregations `aggregationManager.ts`; rooms `dataRoom.ts`;
sharing logs `sharingLog.ts` / `sharingManager.ts` / `inbox.ts`; org node + logo
(`profile/`) `organizationManager.ts`.

**Removal.** Two levels, both on the building page / account menu:
- *Hide* (`toggleHiddenBuilding`) — adds/removes a `gran:hiddenBuilding` entry in
  `prefs.ttl`; non-destructive. The only option for a building *shared from another
  pod* (you can't delete someone else's resource).
- *Delete* (`deleteBuilding`, owned buildings only) — deletes each linked observation
  dataset (and a series' daily chunks) under `observations/`, then the building file.
  No registry to update — the container listing reflects the deletion immediately.
  Guards against touching anything outside the user's own storage root.
- *Remove all app data* (`removeAppData`) — `deleteContainerRecursive` over the whole
  `granergize/` tree (buildings, observations, aggregations, sharing logs, rooms, prefs). It
  **stays logged in**, leaving a fresh, empty `granergize/`: the app resets its query
  caches, re-hydrates the (now absent) active room, and re-offers the demo buildings.
  `profile/` (incl. the org logo) is outside the tree and kept. Container deletion is
  depth-first since CSS won't delete a non-empty container.

Both confirmation prompts **list the exact resources** to be removed
(`listContainedResources` + `formatResourceList`, paths relative to the storage
root, capped with "…and N more") before anything is deleted.

## WebID document (`profile/card`)

Two subjects: the person (`#me`) and the organisation (`#org`), inline in the same
doc.

Person (`#me`, `foaf:Person`):

- `org:memberOf` → `#org` (written by `organizationManager.ts`).
- `foaf:img` → personal avatar, if another tool set one (read-only here).
- `vcard:hasPhoto` → IdP profile photo. Avatar reader (`logoManager.ts`) checks
  `foaf:img` then this.
- `ldp:inbox` → sharing-notification inbox (`share.ts`).
- `foaf:name` / `vcard:fn`.

Organisation (`#org`, written by `organizationManager.ts`):

- `a org:Organization, foaf:Organization`.
- `foaf:name` → company name.
- `foaf:logo` → the uploaded `profile/logo.<ext>`; the avatar's primary image
  (falls back to the person's photo).
- `foaf:homepage` → website (optional).
- `owl:sameAs` → the organisation's own WebID, if any (optional).

`org:memberOf` targets a **local** `#org` node, not an external org WebID, because
that node is the only one we can write (holds name/logo/homepage); a supplied org
WebID is recorded as `owl:sameAs`.

Distinct from **building agents** (`bldg:investor` / `rec:operatedBy` /
`schema:customer` → agent IRIs), which are dereferenced **on demand** by the agent
resolver (`resolveAgent` / `resolveAgentOrg`) for a name, logo and contact details —
driving the producer/operator org name + logo in the map marker's hover card. An
app-created building's agents are WebIDs (resolved from their own profile). A **bulk
importer** (the logistik generator) instead **mints** each operator as a shared
`agents/<slug>.ttl` doc (`foaf:Organization` + `foaf:name` + `owl:sameAs` its
Wikidata/MaStR identity + a basic `vcard:hasAddress` snapshotted from the operator's
MaStR record) and points `rec:operatedBy` at it via a relative reference, so
the same operator dedups across buildings and resolves from local Pod data without a
CORS-blocked external fetch — mirroring how energy datasets are minted under
`observations/`. (The old unused `agents.ttl` *registry* source is gone — separate from
the `agents.ttl` address-book file above.)

## Load flow

1. **Own buildings** by *listing* `buildings/` (`listDirectChildren`): `null` (404)
   means a fresh Pod → load empty + offer the demo banner; `[]` means the container
   exists but is empty; otherwise the top-level `*.ttl` files.
2. **Shared buildings** by *folding* the `shared-in/` log for `gran:kind rec:Building` grants
   (their resources may live on other Pods).
3. Fetch each source (per-source blank-node scoping), prune inaccessible, subtract
   the hidden list and read the active room from `prefs.ttl`, parse via
   `buildingParser`. Provenance is read from each building file's PROV attribution.
4. Declared `cons:granularity` decides energy strategy (not the producer role).

Fetch/load mechanics: see [`data-deref.md`](./data-deref.md). Inaccessible-source
self-heal and the fold: see [`sharing.md`](./sharing.md).

**Building coordinates.** Written as a `geo:location` → blank node
`[a geo:Point ; geo:lat … ; geo:long … ; bldg:geocodePrecision bldg:Address|bldg:Postcode|bldg:City]`
(the precision records how exact the geocode was — full street vs postcode+city vs
city only). The parser prefers this point but still reads a legacy *flat*
`geo:lat`/`geo:long` on the building subject as a fallback (and `buildingSerializer`
migrates the flat form to the point on edit).

## Rationale

**One root.** All app data hangs off a single `<storageRoot>granergize/` tree via
`podResources(webId)`, the one source of truth for paths. Spanning several bases —
`getStorageRoot + granergize/`, `getPodBaseUrl + granergize/`,
`getStorageRoot + profile/granergize/` — desyncs for any WebID not shaped
`<pod>/profile/card`, surfacing as a silently "empty" Pod. `profile/` keeps only
identity (the WebID `card` and the org `logo.<ext>`). There is no migration: older
`profile/granergize/…` data is orphaned and Pods re-bootstrap.

**No registries.** Every list derives from the Pod's own structure — container
listings and folded event logs — rather than separate index files. An index that can
desync from the resources it names is one more thing to keep consistent, and a single
PUT adds a building, so a listing can't lag. See the *Tree* above and the storage-model
rationale in [`queries-mutations.md`](./queries-mutations.md).

**Storage root the Solid way.** The root is resolved from `<webId> pim:storage <root>`
in the WebID doc (`resolveStorageRoot(gateway)`, once at login, cached), not by
string-munging the WebID origin up to `/profile/` — that munge breaks for
off-`/profile/` or separately-hosted WebIDs. It throws if the profile declares no
`pim:storage` (no fallback). Scope is the storage *root* only — within-Pod paths stay
hardcoded; a `solid:TypeIndex` for full cross-app discovery remains out of scope.
