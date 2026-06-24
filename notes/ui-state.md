# UI state and the URI

The app holds a tree of view state. Some of it is *navigational* — it defines what
you are looking at, and should survive a browser reload and be shareable as a link.
The rest is *ephemeral* — transient interaction state (busy flags, menu anchors, form
drafts, in-flight data) with no value beyond the moment.

Navigational state is encoded in the URI — the route path plus its query params;
ephemeral state stays in React component state. These are the two UI-owned tiers of
the app's wider state taxonomy (cache, Pod-persistent prefs, module stores — see
[`architecture.md`](./architecture.md) §The render cycle). This note is the inventory
the encoding works from, and the one place the scheme is written down so increments
stay consistent.

## Routing today

Routing is a `BrowserRouter` (`src/App.tsx`) with a `basename` (`appBasename()`), so
the app works under the subpath it is deployed at. The **route IS the active finder**
— there is no `?tab=` param. The six finder (collection) routes are the home tabs
(`AppShell.tsx` `NAV`):

- `/buildings` — owned + shared building markers and the actionable List
- `/observations` — the energy cube (geographic energy, summary list, heatmap, trend)
- `/aggregations` — saved aggregations (own / shared / open regional datasets)
- `/sharing` — a lean audit of incoming building grants + the inbox
- `/contacts` — the address book
- `/rooms` — data rooms

The standalone full-page detail routes carry the resource id **as a query param** —
`?ref=` for a storage-relative (own) id, `?uri=` for an absolute (foreign/shared) IRI
— never a path segment, so a raw `/` or `#` in the id can't truncate the path (see
[`storage-layout.md`](./storage-layout.md), `src/routes.ts`):

- `/building` — a building's master data
- `/observation` — a building's energy/observations (Energy/AnnualEnergy + weather)
- `/aggregation` — one aggregation's definition + computed snapshot
- `/room` — a data-room deep link (records the room as active, lands on Rooms)
- `/contact` — a contact (always `?uri=` — a WebID is absolute)
- `/regional` — a public open-data regional dataset (`?table=` + `?ags=`)
- `/data-sources` — the data-source catalogue

(In informal prose and code comments a detail page is often written `/building/:id`,
shorthand for "the building page"; the wire form is `/building?ref=…`.)

The finder's in-tab axes/filters and everything inside the detail pages are in the
URI only via the query params below; anything not encoded resets on reload.

A reload does **not** trivially preserve the URI: the Solid auth library restores the
session via a *silent redirect* (`prompt=none`) through the identity provider, which
returns to the bare redirect URI. The library hands the pre-redirect URI back through
its `sessionRestore` event; `Login.tsx` replays it with `history.replaceState` to the
pre-redirect `path + search + hash` and a synthetic `popstate` (no reload, so the
restored session survives), bringing the `BrowserRouter` route and its query params
back. A `restoreAttempted` breadcrumb stops a re-bounce when the restore lands on a
dead-end IdP error (`shouldRestoreSession` in `sessionRestore.ts`). Every deep link
depends on this restore to survive a logged-in reload; the e2e spec
`session-restore.spec.ts` guards it.

## The scheme

Navigational state lives in query params on the finder route. They are written with
React Router's `setSearchParams` **callback form** (each axis derives the next params
from the previous, setting only its own keys and preserving the rest) and with
`replace: true`, so switching does not pile up browser-history entries. The
pure axis resolvers (`src/services/cube/exploreAxes.ts`,
`observationsAxes.ts`) own the read/serialize so they stay Tier-1 testable. Slugs are
human-readable; defaults are omitted from the URI for clean links.

Encoded now:

- `space` — the **Buildings** finder's spatial axis: `map | rows` (absent → map).
  Buildings is space/identity only — owned/shared markers and the List — so it carries
  no energy params (its marker colour is hardcoded `ownership`, not a URI axis).
- `view` — the **Observations** finder's view axis: `map | list | overtime | overyears`
  (absent → map). `map` = geographic energy markers banded at the chosen year; `list` =
  the per-building summary; `overtime` = the buildings × years efficiency heatmap (with
  a trailing year-over-year trend column); `overyears` = the metric's raw figures over
  the years, one line per building.
- `m` — the energy metric (the cube's measure axis), shown/written by the metric
  selector on every Observations energy view except the plain List; one shared choice.
- `y` — the Observations map's energy time-cut year (the year the energy colour bands
  by). Clamped on read to the reachable year set; absent → the latest year. Set by the
  year slider (and its play/pause animation) inside `BuildingsMap`.
- `guise` — the **Aggregations** finder's collection guise: `list | map | timeline`
  (absent → list); `map` = a region choropleth, `timeline` = a cross-year view, both
  keyed on the aggregation's recorded spatial extent.
- `c` / `z` — the map viewport (centre / zoom), shared by both map surfaces.
- `q` / `offset` — a finder's keyword search and list-pager position
  (`useListSearch` / `usePaging`); every single-list finder uses the bare names.
- `tiers` — a finder's multi-select source-tier facet (`useListFacet`): owned (`mine`),
  received (`shared`), public (`open`) — the provenance ladder owned by
  [`open-data.md`](./open-data.md).
- `action` — a palette-routed dialog opener on a finder/detail (e.g. `add`,
  `create-aggregation`, `share-aggregation`), so the command palette and deep links can
  open a dialog by URI.
- `wp` / `ws` — the observation page's **Weather** sub-state: the selected weather
  parameter (`wp`, default mean temperature omitted) and station (`ws`, absent → the
  nearest, auto-seeded from the fetched list). Owned by `weatherParams.ts`; changing the
  parameter clears `ws` so the nearest re-seeds for the new parameter's station list.
- `tab` / `day` / `month` — the observation page's **user-energy (Lastgang) chart**
  sub-state: the view tab (`tab` = `day`|`totals`|`profile`|`calendar`, default `day`
  omitted) and the day/month pickers (`day` = `YYYY-MM-DD`, `month` = `YYYY-MM`, each
  absent → the first day / latest month). Owned by `seriesChartParams.ts`.

The Buildings map is a **pure finder**: a marker click navigates to the building's
standalone page (`/building`), so there is no selected-building / detail-sub-tab query
state to encode (the former `b`/`dt` params are gone). Energy and weather are sections
on the building's observation page (`/observation`), reached by route.

The named observation-page sub-states are now URI-encoded: the Weather parameter/
station (`wp`/`ws`) and the user-energy chart's view/day/month (`tab`/`day`/`month`),
both listed above. (An earlier draft of this paragraph also named a "map-fullscreen
flag" — no such control exists in the map components.)

One deliberate exception: the active data room is *not* a query param. It is
Pod-persistent state (`gran:currentRoom` in `prefs.ttl`, mirrored in memory by
`activeRoom`) and is entered through the `/room` deep-link, which records it and lands
on Rooms. The room you are in is a property of your account, not of the page address.

## Preserved component state — the map viewport

Between navigational and ephemeral sits a third kind of view state: worthless to a
*reload* or a *shared link* (so not navigational), yet it should survive *in-session*
navigation — drilling into a detail page and coming back. The **map viewport**
(zoom/center) is the case in point: re-framing the map every time you return from a
building's page is jarring, but the exact view is not worth a bookmarkable param.

The home for it is a **module-level store** (`src/lib/mapViewport.ts`, mirroring
`networkActivity`/`devMode`): the map writes the viewport on every pan/zoom settle and
reads it once on (re-)mount to restore it. Because the singleton outlives the finder's
unmount, returning from a detail page restores the *exact* view — with nothing to
encode, and correctly lost on a reload (an in-session view isn't navigational). It
replaces the old, fragile serialize-and-restore: the standalone detail routes render
shell-less, so they **unmount the finder**, and a fresh map could clobber/race the saved
`?c`/`?z` with its own default-centre move — snapping back to the all-buildings fit
(`FitToBuildings`).

**Why not keep it in the URL, like the navigational state?** Because the viewport is not
navigational. The exact float centre/zoom is worthless to a *reload* (re-fitting a fresh
load is fine) and to a *shared link* (nobody bookmarks "centre 50.0, zoom 14"); forcing
it into the address would *grant* it reload-survival and shareability it should not have,
and rewrite the URL on every pan/zoom (high churn, no value). The snap-to-fit bug was the
symptom of that mis-classification: a URL-backed value must round-trip — serialize → URL →
re-read → re-apply on re-mount — and the re-apply raced the fresh map's default-centre
move. A module store is a direct read of a live value: no round-trip, no race, and it
dies on a reload (correct). (The race is fixable with a guard, but that is machinery to
keep a non-navigational value in a navigational place.)

The `?c`/`?z` URL params stay, but only as an optional **deep-link seed** (a shared map
URL, or an e2e wanting a specific viewport) and the input the open-data fetch
(`openViewport`) keys on — a different role from the in-session live view the store owns.
On restore the store wins; the params seed a fresh map that has no stored viewport yet,
and `FitToBuildings` stands down for either.

Purer future direction (deferred): render the detail pages *inside the mounted shell* (a
nested/overlay route) rather than as shell-less standalone routes, so the finder is never
torn down at all — which would preserve the list scroll and pager for free too, and let
the `?c`/`?z` restore code go entirely. That is a routing refactor for its own pass.

## Inventory

### Shell — `src/pages/AppShell.tsx`

- Navigational: the active finder is the route path (no param).
- Ephemeral: the avatar-menu anchor, the Organisation dialog open flag, the
  demo-buildings banner (its dismissal is Pod-persistent in `prefs.ttl`, the banner
  visibility is not), the "Remove all app data" wiping flag, and the archive
  import/export busy flags.

### Buildings finder — `src/pages/BuildingsFinder.tsx` (+ `components/building/BuildingsMap.tsx`)

- Navigational: the spatial axis → `space` (Map ⇄ List, owned/shared only); search +
  paging → `q`/`offset`; the source-tier facet → `tiers`. A marker/row click navigates
  to `/building` (every surface is a finder).
- Preserved component state (see §Preserved component state): the map viewport — held in
  the `mapViewport` module store (survives the finder's unmount), not URL-encoded.
- Ephemeral: the tile-loading token.

### Observations finder — `src/pages/ObservationsFinder.tsx` (+ `BuildingsMap colour="energy"`, `ObservationsMatrix`, `ObservationsOverYears`)

- Navigational: the view axis → `view`; the energy metric → `m`; the map's time-cut
  year → `y`; paging → `offset`. Every surface (map markers, list rows, heatmap cells,
  trend rows) navigates to `/building` or `/observation`.
- Preserved component state (see §Preserved component state): the map viewport.
- Ephemeral: the drag-local draft year and the play/pause flag, the energy intensities
  derived per building, the tile-loading token.
- Children: `WeatherData` (a section on the observation page) encodes its selected
  parameter and station in the URI (`wp`/`ws`, `weatherParams.ts`); `UserEnergyChart`
  encodes its view, day and month (`tab`/`day`/`month`, `seriesChartParams.ts`);
  `Building`, `Energy` and `AnnualEnergy` hold only fetched and derived data.

### Aggregations finder — `src/pages/AggregationsFinder.tsx`

- Navigational: the collection guise → `guise` (list / map / timeline); search + paging
  → `q`/`offset`; the source-tier facet → `tiers` (own `mine`, received `shared`, open
  regional `open`); the create dialog → `action=create-aggregation`. A row opens
  `/aggregation` (or `/regional` for an open dataset).
- Deferred-navigational: the map/timeline viewport.
- Ephemeral: everything inside `CreateAggregationDialog` / `ShareAggregationDialog`.

### Sharing finder — `src/pages/SharingFinder.tsx`

- Navigational: the list-pager position → `offset` (incoming building grants).
- Ephemeral: per-row visibility toggle in flight, the lazily fetched shared building,
  the inbox-check and "download all" busy flags. (The shared *content* is browsed in
  its own finder — buildings in Buildings, aggregations in Aggregations — at the
  `shared` tier; this finder is the relationship audit.)

### Contacts finder — `src/pages/ContactsFinder.tsx`

- Navigational: search + the list-pager position → `q`/`offset`.
- Ephemeral: the contact input fields inside the add/edit flow.

### Rooms finder — `src/pages/RoomsFinder.tsx`

- Navigational: search + the list-pager position → `q`/`offset`.
- Pod-persistent, not a query param: the active room (see the exception above).
- Ephemeral: the draft roles before saving, the room input fields, the QR-scanner
  visibility.
