# Architecture — source layers & packages

How the front-end source tree is sliced into layers and which way dependencies flow.
Companion to [`operations.md`](./operations.md) (the query/mutation taxonomy that the
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
                         folders (multi-file domains): interop/, aggregation/,
                          organization/, agents/
                         flat modules: TurtleParsingService, buildingActions,
                          contacts, bookmarks, prefs, attachmentManager, geocode
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
Navigational state (which tab, which building) is URL-encoded — see
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
query/mutation split is named for — see [`operations.md`](./operations.md). UI gets Pod
data only through this layer.

**Services** (`src/services/`). The domain logic the hooks call. The multi-file domains
keep a **folder** — `interop/` (sharing, data rooms, inbox), `aggregation/` (computes and
persists views), `organization/` (org node + avatar), `agents/` (WebID→identity resolution
and cross-building appearances) — while single-resource units are **flat modules** beside
`TurtleParsingService` (the root load-and-parse orchestrator): `contacts`, `bookmarks`,
`prefs`, `attachmentManager`, `buildingActions` (the delete-orchestration helper), and
`geocode` (external geocoding). A folder marks a sub-domain with several collaborating
files, not a one-file-per-Pod-resource mirror; a single owned resource is just a module.
The three mutation models live here — see [`operations.md`](./operations.md),
[`sharing.md`](./sharing.md), [`room.md`](./room.md), and [`views.md`](./views.md). These
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
[`operations.md`](./operations.md) (§Seams), not repeated here.

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
- **`xlsx`** — XLSX import/export of building templates.

The build is **Vite**; because the app is served from a host subpath, `vite.config.ts`
sets `base: "./"` and routing uses `HashRouter` (CLAUDE.md, Deployment). Versions are
intentionally omitted here — `deno.json` is their source of truth.

## Tests

Tests sit alongside this structure rather than in it: a four-tier ladder from a hermetic
unit suite up to real-Pod browser specs, documented in [`test/README.md`](../test/README.md).
Tier-1 unit tests live next to the code they cover (`src/**/*.test.ts`); the higher tiers
live under `test/`.
