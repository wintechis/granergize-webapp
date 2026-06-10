# Data layout — on the Pod (LDP)

> **Current layout below.** The single-root move and `pim:storage` discovery are
> shipped; see *History* at the end for their rationale.

On-Pod file layout, rooted at the storage location discovered via `pim:storage`.
Companion to
[`building-pane.md`](./building-pane.md) (the building pane) and
[`data-schema.md`](./data-schema.md) (provenance & graph shapes).

Paths derive in `src/services/pod/solidUtils.ts`. Writes are PUT/POST only (no
PATCH); cache-sensitive reads use `fetchFresh`.

## One root

The storage root is resolved **once at login** from `pim:storage` on the WebID
(`resolveStorageRoot(session)` in `solidUtils.ts`; throws if the profile declares
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
    ├── buildings/<id>.ttl       subject <…/buildings/<id>.ttl#<id>> (discovered by LISTING — no registry)
    │   └── …/<id>/energy/<year>-<granularity>[-planned].ttl   one EnergyDataset per (year, granularity, scenario)
    │       └── …/<year>-PT15M/<date>.ttl                      series: descriptor .ttl + daily files in the folder
    ├── views/
    │   ├── <id>.ttl             one view-definition resource (discovered by listing)
    │   └── snapshots/<id>.ttl   shareable computed snapshots
    ├── shared-out/<event>       append-only log: sharing performed (POST-minted child URIs)
    ├── shared-in/<event>        append-only log: sharing received (folded to "shared with me")
    ├── rooms/<uuid>             data rooms you HOST (append-only AS2/SIOC activity logs)
    └── inbox                    LDP inbox (sharing notifications)
```

No registries. Each list is derived from the Pod's own structure: own buildings
and view definitions by **listing** their container; the active room, hidden
buildings, and demo-offer state from **`prefs.ttl`**; external room bookmarks from
**`bookmarks.ttl`**; what's shared in/out by **folding** the append-only event
logs (`shared-in/`, `shared-out/`). The old `dataSources.ttl` /
`sharingRegistry.ttl` / `views/viewSharingRegistry.ttl` /
`views/viewDefinitions.ttl` / `views/computed/` / `hiddenBuildings.ttl` /
`rooms.ttl` registries are gone (see *History* below).

**Energy file layout.** Each building links its datasets with
`cons:hasEnergyDataset`; the link slug `<year>-<granularity>[-planned]` is
self-describing, so year/granularity/scenario are known **without** fetching the
file. An annual aggregate (`P1Y`) holds inline SOSA observations in one
`<year>-P1Y.ttl`; a 15-minute series (`PT15M`) is a descriptor `<year>-PT15M.ttl`
plus per-day reading files under `<year>-PT15M/`. (Load phasing: see
[`data-deref.md`](./data-deref.md).)

**Sharing logs (no registry).** `shared-out/` and `shared-in/` are symmetric,
append-only LDP containers, one resource per sharing *event* (a `POST` lets the
server mint each child URI, so concurrent appends never clobber). The WAC `.acl`
stays the enforcement truth; these logs are the app's *record* and the only way a
recipient learns of a grant. Event model and grant/revocation folding: see
[`sharing.md`](./sharing.md).

**Demo buildings (offered, not auto-seeded).** A fresh Pod (no `buildings/`
container at all) is *offered* the demos via a dismissible banner
(`useDemoSeedPrompt` in `index.tsx`); choosing "Add examples" calls
`seedDemoBuildings(session, webId)`, which writes two real, *user-owned* demo
buildings through the normal pipeline (Nordostpark 84 and Lange Gasse 20, Nürnberg;
coordinates geocoded at seed time via Nominatim). The two carry energy at
**different granularities** so a new user sees both loader shapes: Nordostpark has
an inline annual (`P1Y`) SOSA aggregate; Lange Gasse a 15-minute (`PT15M`)
load-profile series. Declining persists in `prefs.ttl` as `gran:demoSeedDeclined`,
so the banner doesn't nag on every login. Nothing is seeded silently.

Origins (all via `podResources(webId)` unless noted): prefs `prefs.ts`; bookmarks
`bookmarks.ts`; buildings/energy `buildingSerializer.ts`; own-building discovery +
shared-fold `TurtleParsingService.ts`; views `viewManager.ts`; rooms `dataRoom.ts`;
sharing logs `sharingLog.ts` / `sharingManager.ts` / `inbox.ts`; org node + logo
(`profile/`) `organizationManager.ts`.

**Removal.** Two levels, both in the building pane / account menu:
- *Hide* (`toggleHiddenBuilding`) — adds/removes a `gran:hiddenBuilding` entry in
  `prefs.ttl`; non-destructive. The only option for a building *shared from another
  pod* (you can't delete someone else's resource).
- *Delete* (`deleteBuilding`, owned buildings only) — recursively deletes its
  `buildings/<id>/…` energy subtree, then the building file. No registry to update —
  the container listing reflects the deletion immediately. Guards against touching
  anything outside the user's own storage root.
- *Remove all app data* (`removeAppData`) — `deleteContainerRecursive` over the whole
  `granergize/` tree (buildings, energy, views, sharing logs, rooms, prefs). It
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
`schema:customer` → agent IRIs), which the building parser dereferences for
`schema:name` only. There is no separate agent data source on the Pod (the old
unused `agents.ttl` registry source is gone).

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

## Known gaps

- **Org logo read authenticated**: the avatar fetches `foaf:logo` as the logged-in
  user. Other users / map markers would need a public-read ACL — not set today.
- **Agents minimal**: only `schema:name` is parsed. The user's `#org` is the first
  real org node; building agents need the same treatment to drive marker logos.

---

## History (rationale)

Two consolidations produced the layout above.

**One root.** App data used to span three bases (`getStorageRoot + granergize/`,
`getPodBaseUrl + granergize/`, `getStorageRoot + profile/granergize/`), which
desynced for any WebID not shaped `<pod>/profile/card` → silent "empty" pod. Fixed
by making `podResources(webId)` the single source of truth, every path under one
`<storageRoot>granergize/` tree. `profile/` keeps only identity (the WebID `card`
and the org `logo.<ext>`). Clean break — no migration; old `profile/granergize/…`
files are orphaned and pods re-bootstrap. (This move targeted an *interim* layout
with flat registries; the later storage redesign then dropped the registries
entirely for listing / log-folding — see the *Tree* above and
[`storage-model.md`](./storage-model.md).)

**Storage root the Solid way.** The old `getStorageRoot` string-munged the WebID
(`origin` up to `/profile/`), which breaks for off-`/profile/` or separately-hosted
WebIDs. Replaced by `resolveStorageRoot(session)` (`solidUtils.ts`): reads
`<webId> pim:storage <root>` from the WebID doc, resolved once at login (`App.tsx`)
and cached; `getStorageRoot(webId)` is now cache-or-throw, the string-munge deleted.
Throws if the profile declares no `pim:storage` (no fallback). Scope is the storage
*root* only — within-pod paths stay hardcoded; a `solid:TypeIndex` for full
cross-app discovery remains out of scope.
