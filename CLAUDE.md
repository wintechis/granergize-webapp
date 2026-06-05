# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Granergize WebApp is a React + TypeScript single-page app for browsing and comparing
energy consumption data of buildings. Data lives in user-controlled
[Solid](https://solidproject.org/) Pods as RDF (Turtle), modeled with the
[Granergize Ontology](https://solid.ti.rw.fau.de/gra/vocab.ttl#). The app authenticates
against a Solid identity provider, fetches Turtle from multiple Pod sources, parses it
into typed structures, and renders maps, charts, and tables.

## Runtime & Commands

The project runs on **Deno 2** (not Node), though dependencies are npm/jsr packages.

- `deno install` — install dependencies
- `deno task dev` — start Vite dev server at http://localhost:5173
- `deno task build` — production build to `dist/`
- `deno task test` — run the test suite (`deno test -A`)
- `deno run -A npm:eslint .` — lint (ESLint flat config in `eslint.config.js`; ignores `dist`)

Tests live next to the code as `*.test.ts` and run under Deno's built-in test runner
(`deno test`). They use **offline fixtures** — e.g. `TurtleParsingService.test.ts` drives
`fetchAndParseData` with a fake `Session` whose `fetch` serves in-memory Turtle per URL, so
no network/Pod is needed. Browser-typed test files need `/// <reference lib="deno.ns" />` at
the top and should import assertions from `node:assert` to avoid remote deps. There is no
configured lint/typecheck task in `deno.json`; TypeScript checking happens via the IDE /
Vite build (`tsconfig.app.json`).

**React hook tests** run under Deno too: `import "./test-dom-setup.ts"` FIRST
(it registers happy-dom globals before React/Testing Library load), then use
`renderHook` from `@testing-library/react` with a `QueryClientProvider` wrapper
(`src/hooks/queries.test.ts` is the template). Note: full **component** render of the
MUI pages does NOT work under `deno test` — Deno can't resolve MUI's extensionless
subpath imports (`@mui/material/Alert`, …) and the type-checker rejects MUI icons as
JSX; cover page render/interaction behaviour with the Playwright e2e suite instead. The
data hooks read the session via
`getSession()` (`src/hooks/session.ts`); tests substitute a fake offline-fixture session
with `_setSessionForTesting(...)` (and prime the storage root via `_setStorageRootForTesting`),
mirroring the service-test pattern.

## Environment

- `VITE_WEATHER_API_URL` selects the weather data backend. In dev it defaults to the
  Vite proxy `/weather-api/` (configured in `vite.config.ts` → `wetterdienst-rdf-adapter.deno.dev`);
  in prod it points directly at that adapter. See `.env.development` / `.env.production`.

## Deployment

`.github/workflows/main.yml` runs on every push: builds with Deno and SCPs `dist/` to a
remote host (`public_html/testing/granergize/`). The app is served from a subpath, which is
why `vite.config.ts` sets `base: "./"` and routing uses `HashRouter`.

## Architecture

### Data flow
1. **Auth** — `@inrupt/solid-client-authn-browser`. `src/pages/Login.tsx` handles the
   Solid login redirect; on login `main.tsx` calls `instrumentSessionFetch` (wraps the
   session's `fetch`) and renders the provider stack `NotificationProvider` →
   `QueryProvider` → app. The authed session is reached app-wide through the
   `getSession()` singleton (`src/hooks/session.ts`), which tests override via
   `_setSessionForTesting`.
2. **Data layer (React Query)** — data is read through hooks in `src/hooks/queries.ts`
   (each calls `getSession()` for the authed transport; query keys are namespaced by
   WebID so a re-login can't read another user's cache). `useSolidData()` is a
   back-compat selector composing `useBuildingsAndAgents` (phase 1: buildings + agents,
   paints the map) and `useEnergy` (phase 2: energy, dependent on phase 1). The single
   `QueryClient` lives in `src/context/QueryProvider.tsx`, which centralizes error
   routing (`SessionExpiredError` → warning, `ConflictError`/else → error) and
   `keepPreviousData` (a failed refetch keeps the last good data on screen). Freshness
   is server-driven (`staleTime: 0` + conditional GET via `fetchFresh`); the only
   refetch trigger is a write — mutations in `src/hooks/mutations.ts` invalidate their
   own query keys (`queryKeys` in `queries.ts`).
3. **Fetch + parse** — `src/services/TurtleParsingService.ts` orchestrates loading. It
   reads the user's registry at `<pod>/granergize/dataSources.ttl` to discover which
   Turtle files (and their roles) to fetch, loads them with per-source blank-node scoping
   to avoid ID collisions, then delegates to parsers in `src/services/utils/`
   (`buildingParser`, `agentParser`, `energyDataParser`, `userEnergyParser`). Inaccessible
   sources are tolerated and pruned; hidden buildings come from
   `<storageRoot>/profile/granergize/hiddenBuildings.ttl`.

### Roles, provenance & data-shape dispatch
`UserRole` (`types/types.ts`) — `dummy | investor | user | benchmark_service_provider` —
is used for three *separate* things; do not conflate them:
- **Provenance** — who produced a building's data, recorded in the building file as a
  PROV-O qualified attribution: `<#b> prov:qualifiedAttribution [ a prov:Attribution ;
  prov:agent <webid> ; prov:hadRole gran:<category> ]`. The parser
  (`buildingParser.ts`) reads it into `BuildingType.provenance` / `attributedTo`;
  `constants/roles.ts` holds the category↔IRI maps (`PROVENANCE_TO_IRI` /
  `IRI_TO_PROVENANCE`). **Provenance never drives behaviour.** Legacy pods carry the
  category as a `gran:dataSourceRole` triple in the registry; `TurtleParsingService.ts`
  reads that only as a *fallback* when the file has no attribution.
- **Data-room membership role** — the "My role(s)" you self-assign in a room
  (`ConnectPage`), used as a sharing target. Unrelated to a building's provenance.
- **Import/export template** — `parseCsvToFields(file, template)` /
  `buildingToWorkbook` pick the spreadsheet shape (investor row-label / BSP columns /
  generic) by category.

**Behaviour dispatches on the data's shape, not the role.** Energy loading
(`TurtleParsingService.ts`) and the energy-tab render (`Energy.tsx`, `ExplorePage.tsx`)
key on the dataset's declared **granularity** via `isSeriesGranularity(...)`
(`durationUtils.ts`): a sub-hourly series (`PT15M`) is lazy-loaded on click and renders
the time-series chart; an annual aggregate (inline SOSA observations) is bulk-loaded and
renders the annual chart. The map marker distinguishes only owned vs shared (visibility),
not provenance.

### RDF conventions
- **Terminology: say "URI" (RFC 3986), or "IRI" (RFC 3987) for the
  internationalized form RDF actually uses — not "URL".** Resources here are
  identified by URIs/IRIs (a URL is just a locating URI); we have an education
  mandate to use precise wording, so prefer URI/IRI in user-facing text, error
  messages, comments, and identifiers. (RDF terms are IRIs.)
- Vocabulary IRIs are centralized in `src/services/utils/vocabularies.ts` (`GRAN_NS`,
  `INVESTOR_NS`, `BENCH_NS`, SOSA/TIME/SSN, XSD datatypes). Use these constants; don't
  inline IRI strings.
- Predicate→`BuildingType` field mappings live in
  `src/services/utils/config/buildingConfig.ts` (`predicateMap`, `objectPropertyMap`).
  Adding a building property generally means updating both `BuildingType` and these maps.
- RDF parsing/serialization uses `n3` (`Parser`, `Store`, `Writer`, `DataFactory`).
  Shared quad helpers are in `src/services/utils/rdfHelpers.ts`.
- `getStorageRoot` / `getPodBaseUrl` in `solidUtils.ts` derive Pod paths from a WebID and
  handle both subdomain- and path-based Pods — use them rather than string-munging WebIDs.
- Read the user's WebID profile via `loadProfileStore` (`profileDocument.ts`), not a bespoke
  fetch: it caches the parsed profile per session so storage-root / org / avatar reads share
  one GET (call `invalidateProfile` after writing the profile). Mutable Pod reads go through
  `fetchFresh` (`podFetch.ts`), which now revalidates (`cache: "no-cache"`, so 304s work) —
  no `?t=` URL cache-buster. Freshness across writes is otherwise owned by React Query.

### Key feature areas
- **Routing** — `src/App.tsx` defines hash routes: `/`, `/building/:id`, `/agent/:id`,
  `/energy/:id`, `/view/:viewId`. Wrapper components resolve params against context data.
- **Sharing/interop** — `src/services/interop/` implements building sharing between Pods
  via a `sharingRegistry.ttl` and an inbox (`inbox.ts`). Access-grant logic in
  `sharingManager.ts`.
- **Aggregated views** — `src/services/aggregation/` (`viewManager` persists view
  definitions/snapshots as Turtle in the Pod; `viewComputer` computes them).
- **Data integration** — `AddBuildingDialog.tsx` + `buildingSerializer.ts` import buildings
  from XLSX templates (`public/templates/`, parsed with `xlsx`) and serialize to Turtle.

### UI stack
MUI v6 (`@mui/material`, Emotion) with a custom theme in `src/theme.ts`. Charts use
Chart.js via `react-chartjs-2` — registration is centralized in `src/chartSetup.ts`
(imported once in `main.tsx`), and `vite.config.ts` deduplicates `chart.js` to a single
instance (don't import/register Chart.js elsewhere). Maps use Leaflet via `react-leaflet`.
User-facing messages go through `NotificationContext`.

Global network-loading feedback goes through one activity store
(`src/services/utils/networkActivity.ts`): `instrumentSessionFetch` wraps the Solid
session's `fetch` once at login so every Pod request is tracked automatically AND
retries transient throttling (Cloudflare 429/503, see `retryFetch.ts`; the retry sits
above `@inrupt`'s fetch so each attempt gets a fresh DPoP proof). Non-Pod requests opt
in via `trackedFetch` (geocoding — also retried) or `beginActivity`/`endActivity`
(Leaflet tile events in `ExplorePage.tsx`, the weather client). The header
`NetworkActivityIndicator` shows the live in-flight requests inline + a count badge,
and is clickable to open a rolling debug log of finished requests (status, pod-relative
path, duration) — useful for spotting repeated/failed calls. The store keeps that log;
`endActivity(id, { status | error })` records each outcome.

The header indicator's debug log (click the network indicator) is the in-app way to audit
what the app fetches end-to-end — status, pod-relative path, and per-hit timing.

**Loading-spinner policy: the header indicator is the ONLY loading spinner inside the
app shell.** Don't add component-level `CircularProgress`/`LinearProgress` for network
loads — feed the activity store instead. During an in-flight load a region stays blank
(or shows a plain "Loading…" text), and action buttons go `disabled` (no inline
spinner) to prevent double-submit. The exceptions, which keep a local spinner because
the header isn't mounted there, are the standalone full-page routes
(`/building`, `/energy`, `/agent`, `/view/:id`, `/room/:uri` — see `App.tsx`,
`Agent.tsx`, `AggregatedView.tsx`), the pre-auth `Login` screen, and the lazy-chunk
`Suspense` fallback (code-split load, not data).

### UI conventions

The app stays **full MUI** but aims to be **plain and consistent**: a small,
reused widget vocabulary and one way to express each intent — not bespoke one-offs.
(This supersedes an earlier semantic-HTML/de-MUI exploration.) The goal of these
rules is that two screens built months apart look and behave the same. Some are
ESLint-enforced (`eslint.config.js`); the rest are review conventions.

- **Dialogs — one wrapper.** Every dialog goes through `src/components/Modal.tsx`
  (props `open`/`onClose`/`title`/`children`/`actions`/`overlay`/`dirty`/`busy`/
  `maxWidth`), which is backed by MUI `Dialog` and bakes in the structure and the
  close-guard. Raw `@mui/material` `Dialog*` imports are **ESLint-banned** (only
  `Modal.tsx` may import them). Close-guard semantics live in the pure, tested
  `src/components/dialogGuard.ts`: a backdrop click never closes, Escape confirms
  while `dirty`, and closing is suppressed while `busy`; explicit Cancel/X buttons
  call `onClose` directly. Put the primary action last in `actions` and make it
  the single `variant="contained"` button.
- **Loading — one indicator.** The header `NetworkActivityIndicator` is the only
  spinner in the app shell; `CircularProgress`/`LinearProgress` imports are
  **ESLint-banned** outside the exempted full-page-route / Suspense files. Regions
  show plain `Loading…` text (ellipsis `…`, not `...`); action buttons go
  `disabled` while in flight. Feed the activity store, don't add component spinners.
- **Notifications — one mechanism.** Transient user-facing messages go through
  `NotificationContext` (`showNotification(msg, severity)`), never a bespoke
  snackbar. Keep the message vocabulary small and reused; don't add a one-off
  notice for a trivial event. Error toasts use `formatError(action, err)`
  (`src/services/utils/formatError.ts`) → a single `"Failed to {action}: {detail}"`
  shape, instead of ad-hoc "X failed" / "Error X" wording.
  - **Carve-out:** *contextual, persistent* feedback rendered inline in a panel
    or form may use MUI `<Alert>` (e.g. a validation error or a "no data" notice
    inside the weather panel / share dialog) — a snackbar can't stay put or sit
    in context. Use `<Alert>` for in-place state; `showNotification` for transient
    global events.
- **Typography — the theme scale only.** Use a `Typography` `variant` (or the
  semantic-HTML the page already uses); inline `fontSize`/`fontWeight` are
  **ESLint-warned**. One variant per role: page title → `h5`, section header →
  `h6`, body → `body1`, secondary/help → `body2` + `color="text.secondary"`,
  caption → `caption`.
- **Spacing & color — theme tokens.** Use the MUI 8px spacing scale via `sx`
  (section gap `3`, related elements `2`, tight `1`); take colors from the theme
  (`color="text.secondary"`, `"error"`), not hardcoded hex / raw `px`.
- **Buttons.** Primary = `contained`, secondary = `outlined`, cancel/tertiary =
  `text`; at most one primary per dialog/section.
- **Lists & rows.** Reuse `src/components/listStyles.ts`
  (`listStyle`/`rowStyle`/`nestedListStyle`/`ellipsis`) and `usePaging` + `Pager`
  rather than bespoke flex rows, so every list looks and pages the same.
- **Icon actions.** `IconButton size="small"` with both a `Tooltip` and an
  `aria-label`.

When a new widget seems necessary, first check whether an existing
component/pattern covers it; prefer extending the shared one over adding a
single-use variant.
