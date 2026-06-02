# Data layout — on the Pod (LDP)

> **Current layout below.** The single-root move and `pim:storage` discovery
> (formerly "Proposed cleanup" / "Storage root the Solid way") are now **built** —
> those sections are kept for rationale and marked DONE.

On-Pod file layout, rooted at the storage location discovered via `pim:storage`.
Companion to
[`data-view.md`](./data-view.md) (the building pane) and
[`data-schema.md`](./data-schema.md) (per-role schemas).

Paths derive in `src/services/utils/solidUtils.ts`. Writes are PUT/POST only (no
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
    ├── dataSources.ttl          registry: building/agent TTLs, each gran:dataSourceRole-tagged
    ├── hiddenBuildings.ttl       gran:hiddenBuilding list (pruned on load)
    ├── buildings/<id>.ttl        subject <…/buildings/<id>.ttl#<id>>
    │   └── …/<id>/energy/<date>.ttl   per-day 15-min readings (user role; SOSA)
    ├── views/
    │   ├── viewDefinitions.ttl
    │   ├── viewSharingRegistry.ttl
    │   └── computed/<viewId>.ttl  privacy-preserving snapshots (shareable)
    ├── rooms.ttl / rooms/<uuid>   data-room pointers / a room
    └── sharingRegistry.ttl        what this user has shared with whom
```

**External sources (not on your pod).** `dataSources.ttl` lists building/agent
TTLs by URL — they may live on *other* pods. That's why `agents.ttl` isn't in the
tree above: agents are an **external, read-only** source, fetched per the registry,
never written to your storage (the app has no agent writer; parsed for
`schema:name` only).

This is *not* demo-only. Agents are a cross-role concept — `schema:customer`,
`gran:investor`, `rec:operatedBy` are **core** predicates (all roles), rendered as
links in the building pane and used for per-agent averages
(`agentAverages`, keyed on `operatedBy`). A real registry can point
`hasAgentDataSource` at any pod. **Gap:** there's no UI to author your own agents,
so agent data always comes from outside your pod.

**Bootstrap (current).** A fresh pod no longer seeds shared FAU URLs. Instead the
registry is created **empty** (creator only), and `seedDemoBuildings(session,
webId)` writes two real, *user-owned* demo buildings through the normal pipeline
(Nordostpark 84 and Lange Gasse 20, Nürnberg; coordinates geocoded at seed time via
Nominatim). The two carry energy at **different granularities** so a new user sees
both shapes the loader dispatches on: Nordostpark has inline annual (P1Y) SOSA
observations (role `investor`, bulk-loaded, annual chart); Lange Gasse has a daily
15-minute (PT15M) load-profile file (role `user`, lazy-loaded on click). Seeding
runs **once**, gated on the registry having just been bootstrapped — so deleting a
demo building doesn't resurrect it.

Origins (all via `podResources(webId)` unless noted): registry
`TurtleParsingService.ts`, `sharingManager.ts`, `buildingSerializer.ts`,
`inbox.ts`; hidden `TurtleParsingService.ts`; buildings/energy
`buildingSerializer.ts`; views `viewManager.ts`; rooms `dataRoom.ts`; sharing
`sharingManager.ts`; org node + logo (`profile/`) `organizationManager.ts`.

**Removal.** Two levels, both in the building pane / account menu:
- *Hide* (`toggleBuildingVisibility`) — adds/removes a `gran:hiddenBuilding` entry
  in `hiddenBuildings.ttl`; non-destructive, the file stays. The only option for a
  building *shared from another pod* (you can't delete someone else's resource).
- *Delete* (`deleteBuilding`, owned buildings only) — de-registers it
  (`removeBuildingFromRegistry`, the inverse of `addBuildingToRegistry`), recursively
  deletes its `buildings/<id>/…` energy subtree, then the building file. Guards
  against touching anything outside the user's own storage root.
- *Remove all app data* (`removeAppData`) — `deleteContainerRecursive` over the whole
  `granergize/` tree (buildings, energy, views, rooms, registries), then logs out
  **with auto-restore suppressed** (a one-shot `granergize:noRestore` sessionStorage
  flag → `Login`'s `suppressRestore`) so the app can't silently log back in and
  re-bootstrap what was just wiped; the user must log in again explicitly. `profile/`
  (incl. the org logo) is outside the tree and kept. Container deletion is depth-first
  since CSS won't delete a non-empty container.

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
- `foaf:logo` → the uploaded `profile/logo.<ext>` (in the profile folder, since the
  org is part of the profile); the avatar's primary
  image (falls back to the person's photo).
- `foaf:homepage` → website (optional).
- `owl:sameAs` → the organisation's own WebID, if any (optional).

`org:memberOf` targets a **local** `#org` node, not an external org WebID, because
that node is the only one we can write (holds name/logo/homepage); a supplied org
WebID is recorded as `owl:sameAs`.

Distinct from **building agents** (`gran:investor` / `gran:operatedBy` /
`schema:customer` → agent IRIs in `agents.ttl`, parsed for `schema:name` only).

## Load flow

1. WebID → `getPodBaseUrl` → read `profile/granergize/dataSources.ttl`.
2. Registry lists building/agent TTL sources, each `gran:dataSourceRole`-tagged.
3. Fetch each (per-source blank-node scoping), prune inaccessible, subtract
   `hiddenBuildings.ttl`, parse via `buildingParser`/`agentParser`.
4. Role decides energy strategy (user = lazy per-click; investor = inline SOSA).

## Known gaps

- **Org logo read authenticated**: the avatar fetches `foaf:logo` as the logged-in
  user. Other users / map markers would need a public-read ACL — not set today.
- **Agents minimal**: only `schema:name` is parsed. The user's `#org` is the first
  real org node; building agents need the same treatment to drive marker logos.

---

## One-root cleanup (DONE)

> Implemented: all app data now hangs off one `<storageRoot>granergize/` tree via
> `podResources()`; the `getPodBaseUrl`/`profile/granergize/` split is gone (logo
> excepted). Clean break — old `profile/granergize/…` files are orphaned, pods
> re-bootstrap. Kept below for the rationale.

### Problem

Three bases for one logical tree:

- `getStorageRoot` + `granergize/…` → buildings, views, rooms, rooms.ttl
- `getPodBaseUrl` + `granergize/…` → dataSources.ttl, sharingRegistry.ttl,
  views/viewSharingRegistry.ttl, logo
- `getStorageRoot` + `profile/granergize/…` → hiddenBuildings.ttl

So siblings split across trees (`viewDefinitions.ttl` vs `viewSharingRegistry.ttl`),
and `dataSources.ttl` is built two ways that agree **only** for a
`<pod>/profile/card`-shaped WebID — other shapes desync → silent "empty" pod.

### Target: one root

All **app** data under **`getStorageRoot(webId) + "granergize/"`**. `profile/` keeps
identity: the WebID `card` (`#me` + `#org`) **and the org logo** (`profile/logo.<ext>`),
since the org is part of the profile, not app data.

```
https://<pod>/
├── profile/
│   ├── card  (#me, #org)                    identity (unchanged)
│   └── logo.<ext>                           org logo — stays in profile/
└── granergize/                              ← the ONE app root
    ├── dataSources.ttl   registry          ┐ moved (drop the profile/ segment)
    ├── hiddenBuildings.ttl                  │
    ├── sharingRegistry.ttl                  ┘
    ├── buildings/<id>.ttl
    │   └── <id>/energy/<date>.ttl
    ├── views/
    │   ├── viewDefinitions.ttl
    │   ├── viewSharingRegistry.ttl          moved (next to its data)
    │   └── computed/<viewId>.ttl
    └── rooms.ttl  +  rooms/<uuid>
```

Already correct: `buildings/`, `views/viewDefinitions.ttl`, `views/computed/`,
`rooms*`, and `profile/logo.<ext>`. The moves just drop the `profile/` segment from
the app files — the real point is to stop deriving app paths from the WebID
document's directory. The org logo is the deliberate exception: it's profile data,
so it stays in `profile/`.

### Code changes

- **`solidUtils.ts`** — make `podResources(webId)` the single source of truth,
  every entry on `getStorageRoot + "granergize/"`; fold `registryUrl` into it.
- **Callers** route through `podResources`: `TurtleParsingService`,
  `buildingSerializer`, `inbox`, `sharingManager` (sharingRegistry, hidden,
  viewSharingRegistry), `organizationManager` (logo + the `foaf:logo` IRI it
  writes into `card`). `viewManager`/`dataRoom` already use storageRoot.
- **Tests** — update fixtures hardcoding `profile/granergize/…`
  (`TurtleParsingService.test.ts`, sharing/inbox).

### Migration: clean break (chosen)

No migration code. Pods re-bootstrap (`dataSources.ttl` recreated with demo
defaults; others on first write); old `profile/granergize/…` data is orphaned, not
deleted. OK while data is disposable; revisit if real pods exist before ship.

---

## Storage root the Solid way: read `pim:storage` (DONE)

> Implemented in `resolveStorageRoot(session)` (`solidUtils.ts`): GET the WebID
> doc, parse with n3, read `<webId> pim:storage <root>`, cache in a module var.
> Resolved once at login (`SolidDataContext.loadData`) before the first fetch;
> `getStorageRoot` is now cache-or-throw and the string-munge is deleted.
> **Throws if the profile declares no `pim:storage`** (no fallback). Kept below for
> rationale.


`getStorageRoot` guesses the pod root by string-munging the WebID
(`origin` up to `/profile/`). This isn't the Solid mechanism and breaks when the
WebID isn't under `/profile/`, is hosted separately from the pod, or the user has
multiple storages — and it's the root cause of the desync above. The correct
source is **`pim:storage`** (`http://www.w3.org/ns/pim/space#storage`) on the WebID.

**Constraint:** `getStorageRoot` is sync and inlined in 12 call sites; a
`pim:storage` read is async. Resolve it **once and cache**, keeping callers sync:

1. `resolveStorageRoot(session)` (async) — GET the WebID doc, parse (n3, as in
   `logoManager`), read `<webId> pim:storage <root>`, cache it in a module var.
   Call once at login alongside `hydrateActiveRoom`, before the first load.
   **No string-munge fallback: if the profile has no `pim:storage`, throw** (a pod
   that doesn't declare its storage is unusable — fail loudly at login, not with a
   silently wrong path later).
2. `getStorageRoot(webId)` stays sync → returns the cached root, and **throws if
   the cache is empty** (resolve hasn't run / failed). The 12 call sites are
   unchanged; the old string-munge derivation is deleted.

**Code:** `solidUtils.ts` (add `PIM_NS`, `resolveStorageRoot`, cache; `getStorageRoot`
returns cache or throws; remove the string-munge); login hydration awaits
`resolveStorageRoot` and surfaces its error (block load, show the failure); offline
tests for both branches (`pim:storage` present → that root; absent → throws).

**Scope:** storage *root* only — within-pod paths stay hardcoded. A
`solid:TypeIndex` for full cross-app discovery is out of scope. Do the one-root
consolidation first, then point `podResources` at the resolved root.
