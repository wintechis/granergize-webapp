# Architecture — source layers & packages

How the front-end source tree is sliced into layers and which way dependencies flow.
Companion to [`queries-mutations.md`](./queries-mutations.md) (the query/mutation taxonomy that the
data-access and service layers implement), [`storage-model.md`](./storage-model.md) and
[`data-layout.md`](./data-layout.md) (the on-Pod side those layers read and write), and
[`data-deref.md`](./data-deref.md) (the fetch/parse path through them). Where those notes
describe *what lives on the Pod*, this one describes *what lives in `src/`*.

The app is a strictly layered single-page app: the dependency arrow points **down** —
UI renders, a React-Query data-access layer mediates, services hold the domain logic,
and a Pod/RDF utility layer does the network and the triples. A layer may call the one
below it; it never reaches back up. The only thing every layer shares is the leaf of
constants and types.

## The layers

```
  entry & providers      main.tsx, App.tsx, theme.ts
        │
  pages                  src/pages/        route-driven screens
        │
  components             src/components/   reusable widgets
        │
  data-access            src/hooks/ + src/context/   React Query
        │
  services               src/services/   domain logic
                         (folders for multi-file domains; flat modules for
                          single-resource units — both enumerated below)
        │
  pod I/O  +  rdf        src/services/pod/, src/services/rdf/ (+ rdf/building/)
        │
  generic helpers        src/lib/   pure: formatting, zip, pool, error, client stores
        │
  constants & types      src/constants/, src/types.ts   (leaf — imports nothing)
```

**Entry & providers.** `main.tsx` mounts the provider stack
(`NotificationProvider` → `QueryProvider` → app) and wraps the session's `fetch` at
login; `App.tsx` owns the `HashRouter` routes and the session gate; `theme.ts` holds the
MUI theme. The auth/login flow these set up is described in CLAUDE.md (Data flow §1).

**Pages** (`src/pages/`). One route-driven screen each — the tab shell (`index.tsx`),
the map (`ExplorePage`), the energy and building detail routes (`Energy`, `Building`),
sharing/manage/connect. Pages compose hooks and components; they never import each other.
Navigational state (which tab, which building) is URI-encoded — see
[`ui-state.md`](./ui-state.md).

**Components** (`src/components/`, `src/components/detail/`). Reusable, mostly stateless
widgets, deliberately a small shared vocabulary rather than one-offs: the `Modal` dialog
wrapper, the `detail/DetailView` card primitives, the list/pager styles. The conventions
that keep this vocabulary uniform (one dialog wrapper, one loading indicator, theme-only
typography) are the UI-conventions section of CLAUDE.md.

**Data-access layer** (`src/hooks/`, `src/context/`). React Query is the seam between UI
and services: read hooks in `queries.ts`, write hooks in `mutations.ts`, the single
`QueryClient` and central error routing in `context/QueryProvider.tsx`, and the
`getSession()` singleton the hooks read their transport from. This is the boundary the
query/mutation split is named for — see [`queries-mutations.md`](./queries-mutations.md). UI gets Pod
data only through this layer.

**Services** (`src/services/`). The domain logic the hooks call. The multi-file domains
keep a **folder** — `interop/` (sharing, data rooms, inbox), `aggregation/` (computes and
persists views), `organization/` (org node + avatar), `agents/` (WebID→identity resolution
and cross-building appearances) — while single-resource units are **flat modules** beside
`TurtleParsingService` (the root load-and-parse orchestrator): `contacts`, `bookmarks`,
`prefs`, `attachmentManager`, `buildingActions` (the delete-orchestration helper), and
`geocode` (external geocoding). A folder marks a sub-domain with several collaborating
files, not a one-file-per-Pod-resource mirror; a single owned resource is just a module.
The storage models and projection disciplines live here — see [`queries-mutations.md`](./queries-mutations.md),
[`sharing.md`](./sharing.md), [`room.md`](./room.md), and [`aggregated-views.md`](./aggregated-views.md). These
domains are siblings: none imports another — cross-domain composition happens a layer up,
in hooks or pages — and all rest on the Pod I/O and RDF layers below. The one sanctioned
cross-service edge is `buildingActions`, which composes `interop/` to revoke a building's
grants before deleting it.

**Pod I/O & RDF** (`src/services/pod/`, `src/services/rdf/`). The two substrate layers
every domain rests on, where anything touching the network or the triples bottoms out.
`pod/` is **Pod I/O** — `podFetch`/`podWrite`/`podDelete`/`podArchive`, the `retryFetch`
throttling wrapper, storage-root and path resolution in `solidUtils`, the
session-gate/restore plumbing, and the cached profile read. `rdf/` is **RDF
parse/serialize** — `rdfHelpers`, the `vocabularies` constants, the energy parsers, the
XLSX workbook bridge, and the duration/category helpers; the building round-trip trio
(`buildingParser` + `buildingSerializer` + their shared predicate↔field table
`buildingConfig`, the parts that co-evolve) is co-located in `rdf/building/`. `rdf/` may
use `pod/`; neither reaches up. The fetch/parse pipeline through here is
[`data-deref.md`](./data-deref.md); the RDF⇄object shapes are
[`data-schema.md`](./data-schema.md).

**Generic helpers** (`src/lib/`). Pure modules with no Pod or RDF dependency, reused
across every layer: date and error formatting, the `download`/`zip` file helpers, the
bounded-concurrency `pool`, and the framework-agnostic client stores (`devMode`,
`networkActivity`, `notificationSink`, and the `notificationQueue`/`dialogGuard` UI
logic). Their React-hook wrappers live up in `src/hooks/` (`useDevMode`, `requestActivity`,
`usePaging`); that store-below / hook-above split mirrors the network-activity pattern in
CLAUDE.md. A module added at the bottom belongs in `pod/`, `rdf/`, or `lib/` by this rule —
Pod I/O, RDF, or neither — and a unit that owns a Pod resource belongs in its own service
folder, not in any of the three.

**Constants & types** (`src/constants/`, `src/types.ts`). The leaf: role/colour maps and
the `BuildingType`/`EnergyType` domain types. Imported by every layer, importing none.

## The render cycle

The layers above are the static slice; at runtime data flows in one direction. A
component is a pure function from its inputs (props + state) to a *description* of the
UI — it never touches the DOM. React reconciles each returned description against the
last and applies the minimal DOM changes itself, so the UI is declarative, not
imperatively redrawn.

Requests never happen during render (render must stay pure and may run repeatedly).
They live in two places: **event handlers** (a user acted → a mutation, an on-demand
load) and the **React-Query hooks** (a screen mounted and needs data → a query). A
resolved request does not redraw anything directly; it updates **state**, and the state
change is what re-runs the affected components. This is the same query/mutation split
the data-access layer is named for ([`queries-mutations.md`](./queries-mutations.md)): safe reads are
queries, state-changing writes are mutations.

State itself lives in five places, by lifetime and ownership. Server state — every
fetched Pod resource — lives in the **React-Query cache**, owned by the data-access
layer; mutations invalidate its keys and the dependent components re-render. A small
subset of that server state is really *application* state that is stored **on the
Pod** because it is a property of the account, not of any page or device: `prefs.ttl`
(active room, hidden buildings, banner dismissal) and `bookmarks.ttl`. It flows
through the same cache and mutation hooks as any other Pod resource, but it outlives
the tab, the browser and the machine. Durable *navigational* state (which tab, which
building) is encoded in the **URI hash** so it survives a reload and is shareable.
**Module-level client stores** sit outside React entirely and live for the tab:
the session singleton (`getSession()`), the active-room mirror (`dataRoom.ts`), the
per-WebID storage-root and profile caches, and the network-activity store; the
Developer-mode flag (`devMode.ts`) persists one step further, in `localStorage`.
Everything else — form drafts, busy flags, menu anchors, in-flight interaction — is
**ephemeral React component state** that may vanish on unmount. The
navigational/ephemeral split and the full inventory are
[`ui-state.md`](./ui-state.md).

## The dependency rule

Imports flow strictly downward, and two consequences are worth stating because they are
easy to violate:

- **Network I/O is funnelled through hooks → services.** A page or component never calls
  `podFetch`/`podWrite` itself; it renders what a hook gives it. The one thing UI *does*
  import straight from `src/services/pod/` is `solidUtils` — but only its pure path/storage-root
  helpers (`podResources`, `getStorageRoot`), which compute IRIs and perform no I/O, so
  the rule that *reads and writes* go through the data-access layer still holds.
- **`interop/` and `aggregation/` stay independent.** Cross-domain composition happens a
  layer up (in hooks or pages), not by one service package importing the other.

The single structural exception is the pair of queries that hide a mutation
(`loadBuildings`, `drainInbox`) — documented as seams in
[`queries-mutations.md`](./queries-mutations.md) (§Seams), not repeated here.

## Packages & runtime

The project runs on **Deno 2** over npm/jsr dependencies (no Node); tasks and the import
map live in `deno.json`. The external packages, by the role they play:

- **`n3`** — RDF parsing and serialization (the `Parser`/`Store`/`Writer`/`DataFactory`
  the utility layer is built on).
- **`@inrupt/solid-client-authn-browser`** — Solid authentication and the authed
  `fetch`.
- **`@tanstack/react-query`** — the data-access layer's caching and invalidation.
- **MUI v6 + Emotion** — the component layer's widget kit and theming.
- **Recharts** — charts (bundled into a `vendor-charts` chunk by Vite).
- **Leaflet / react-leaflet** — the map.
- **`xlsx`** — XLSX import/export of building data.

The build is **Vite**; because the app is served from a host subpath, `vite.config.ts`
sets `base: "./"` and routing uses `HashRouter` (CLAUDE.md, Deployment). Versions are
intentionally omitted here — `deno.json` is their source of truth.

## Tests

Tests sit alongside this structure rather than in it: a four-tier ladder from a hermetic
unit suite up to real-Pod browser specs, documented in [`test/README.md`](../test/README.md).
Tier-1 unit tests live next to the code they cover (`src/**/*.test.ts`); the higher tiers
live under `test/`.
