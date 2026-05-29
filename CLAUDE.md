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
   Solid login redirect; `main.tsx` wires the session into `SolidDataProvider`.
2. **Context** — `src/context/SolidDataContext.tsx` is the single source of truth for
   loaded data (`buildings`, `energyNeed`, `agents`, `averages`, `energyMix`). Components
   read it via `useSolidData()`. It calls `fetchAndParseData` on session change.
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
