# UI state and the URI

The home screen holds a tree of view state. Some of it is *navigational* — it
defines what you are looking at, and should survive a browser reload and be
shareable as a link. The rest is *ephemeral* — transient interaction state (busy
flags, menu anchors, form drafts, in-flight data) with no value beyond the moment.

Navigational state is encoded in the home route's hash query params; ephemeral
state stays in React component state. This note is the inventory the encoding works
from, and the one place the scheme is written down so increments stay consistent.

## Routing today

Routing is a `HashRouter` (`src/App.tsx`). The home screen is `#/`; the standalone
full-page routes — `#/building/:id`, `#/energy/:id`, `#/view/:id`, `#/room/:uri`,
`#/contact/:webId` — live in the hash. The home tabs and everything inside them are
not in the address, so without the encoding below a reload resets them.

A reload does **not** trivially preserve the hash: the Solid auth library restores
the session via a *silent redirect* through the identity provider, which drops the
URL fragment (the whole `#…`). The library hands the pre-redirect URL back through
its `sessionRestore` event; `Login.tsx` replays that URL's fragment — deferred past
the library's own URL cleanup — so the HashRouter route and the query params under
it come back. Every hash-based deep link (the standalone routes included) depends on
this restore to survive a logged-in reload. The Tier-3 spec `uri-state.spec.ts`
guards it.

## The scheme

Navigational state lives in hash query params on the home route. They are written
merged (each owner sets only its own keys, never clobbering the others — see
`mergeParams` in `src/pages/uriState.ts`) and with `replace: true`, so switching
does not pile up browser-history entries. Slugs are human-readable and reorder-safe.

Encoded now:

- `tab` — the active home tab: `explore | manage | share | connect`.
- `b` — the Explore selected building (the building id); absent means none selected.
- `dt` — the Explore detail sub-tab: `building | energy | weather`; only meaningful
  with `b`.

Reserved for later increments (named here so they land consistently):

- `full` — Explore detail fullscreen; and the map viewport (zoom/center).
- Manage deep-link dialogs that target a resource: edit / files / energy / share a
  building, and share a view.
- list paging across Manage, Share and Connect.
- Explore Weather (parameter, station) and user-energy chart (view, date, month).

One deliberate exception: the active data room is *not* a query param. It is
Pod-persistent state (`gran:currentRoom` in `prefs.ttl`, mirrored in memory by
`activeRoom`) and is entered through the `#/room/:uri` deep-link, which records it
and lands on Connect. The room you are in is a property of your account, not of the
page address.

## Inventory

### Shell — `src/pages/index.tsx`

- Navigational: the active tab → `tab`.
- Ephemeral: the avatar-menu anchor, the Organisation dialog open flag, the
  demo-buildings banner (its dismissal is Pod-persistent in `prefs.ttl`, the banner
  visibility is not), the "Remove all app data" wiping flag, and the archive
  import/export busy flags.

### Explore — `src/pages/ExplorePage.tsx`

- Navigational: the selected building → `b`; the detail sub-tab → `dt`. The
  selection is held as a one-entry focus list, so a single building id captures it.
- Deferred-navigational: detail fullscreen → `full`; the map bounding box / viewport.
- Ephemeral: the energy record synced to the selected building (derived), the
  tile-loading token.
- Children: `WeatherData` holds a selected parameter and station (deferred
  navigational); `UserEnergyChart` holds a view, a day and a month (deferred
  navigational); `Building`, `Energy`, `InvestorEnergy` and `BspEnergy` hold only
  fetched and derived data.

### Manage — `src/pages/ManagePage.tsx`

- Deferred-navigational, each addressable by the resource it targets: the building
  being edited, having its files managed, having an energy year edited, or being
  shared; the view being shared; and the two list paging positions (buildings,
  views).
- Ephemeral: everything inside the dialogs (`AddBuildingDialog`,
  `EditBuildingDialog`, `EnergyYearDialog`, the share and create-view dialogs,
  `OrganizationDialog`) — form fields, busy flags, upload progress, abort handles.

### Share — `src/pages/SharePage.tsx`

- Deferred-navigational: the two list paging positions (shared buildings, received
  views).
- Ephemeral: per-row expansion and its lazily fetched snapshot, the lazily fetched
  shared building, the "download all" busy flag.

### Connect — `src/pages/ConnectPage.tsx`

- Deferred-navigational: the two list paging positions (contacts, rooms).
- Pod-persistent, not a query param: the active room (see the exception above).
- Ephemeral: the draft roles before saving, the contact and room input fields, the
  QR-scanner visibility.
