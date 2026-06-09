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
  services               src/services/ + interop/ + aggregation/   domain logic
        │
  pod / rdf utilities    src/services/utils/ (+ config/)   I/O, parse, serialize
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

**Services** (`src/services/`, `…/interop/`, `…/aggregation/`). The domain logic the
hooks call. `TurtleParsingService` orchestrates load-and-parse; `interop/` implements
sharing, data rooms, and the inbox; `aggregation/` computes and persists views. The
three mutation models live here — see [`operations.md`](./operations.md),
[`sharing.md`](./sharing.md), [`room.md`](./room.md), and [`views.md`](./views.md).
`interop/` and `aggregation/` are siblings: neither imports the other; both rest on the
utilities below.

**Pod / RDF utilities** (`src/services/utils/`, `…/config/`). The lowest layer, where
everything that touches the network or RDF bottoms out: Pod I/O (`podFetch`, `podWrite`,
storage-root and path resolution in `solidUtils`), RDF parse/serialize (`rdfHelpers`, the
`vocabularies` constants, the building/energy parsers and serializers), and the
declarative predicate↔field table in `config/buildingConfig.ts`. The fetch/parse pipeline
through here is [`data-deref.md`](./data-deref.md); the RDF⇄object shapes are
[`data-schema.md`](./data-schema.md).

This is the layer's weak spot: `utils/` is a flat grab-bag of ~40 modules that conflates
three distinct kinds of thing, and the flatness hides the seams. The latent sub-groups
are (a) **Pod I/O** — `podFetch`/`podWrite`, archive/delete, storage-root and path
resolution in `solidUtils`, the session-gate/restore plumbing; (b) **RDF** — `rdfHelpers`,
the `vocabularies` constants, the building/energy parsers and serializers, duration
helpers; (c) **generic helpers** with no Pod or RDF dependency — date formatting,
download, zip, the concurrency pool, error formatting. Folded in alongside them are
several modules that are really **domain services**, peers of `interop/`/`aggregation/`
rather than utilities — the contacts, bookmarks, prefs, organization, attachment, and
agent-resolution managers. The dependency direction is clean regardless (nothing here
imports upward), so the cost is readability, not correctness: "utils" undersells the
domain logic it contains. Treat these groupings as the intended shape — a module added
here belongs in whichever of them fits, and a manager that owns a Pod resource belongs in
a service folder, not under `utils/`.

**Constants & types** (`src/constants/`, `src/types.ts`). The leaf: role/colour maps and
the `BuildingType`/`EnergyType` domain types. Imported by every layer, importing none.

## The dependency rule

Imports flow strictly downward, and two consequences are worth stating because they are
easy to violate:

- **Network I/O is funnelled through hooks → services.** A page or component never calls
  `podFetch`/`podWrite` itself; it renders what a hook gives it. The one thing UI *does*
  import straight from `utils/` is `solidUtils` — but only its pure path/storage-root
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
