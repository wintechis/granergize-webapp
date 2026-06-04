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

### Roles
`UserRole` (`types/types.ts`) — `dummy | investor | user | benchmark_service_provider` —
drives which RDF predicates and energy-loading strategy apply per building source. Roles
map to gran: IRIs (see `IRI_TO_ROLE` maps). Notable per-role behavior in
`TurtleParsingService.ts`: **user**-role energy data is loaded lazily on building click;
**investor**-role energy is synthesized from inline SOSA observations (no separate files).

### RDF conventions
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

To audit what the app fetches end-to-end, `e2e/request-audit.spec.ts` logs in and prints
every request with per-hit timing (`source .env.e2e.local && deno task e2e request-audit`).

**Loading-spinner policy: the header indicator is the ONLY loading spinner inside the
app shell.** Don't add component-level `CircularProgress`/`LinearProgress` for network
loads — feed the activity store instead. During an in-flight load a region stays blank
(or shows a plain "Loading…" text), and action buttons go `disabled` (no inline
spinner) to prevent double-submit. The exceptions, which keep a local spinner because
the header isn't mounted there, are the standalone full-page routes
(`/building`, `/energy`, `/agent`, `/view/:id`, `/room/:uri` — see `App.tsx`,
`Agent.tsx`, `AggregatedView.tsx`), the pre-auth `Login` screen, and the lazy-chunk
`Suspense` fallback (code-split load, not data).
