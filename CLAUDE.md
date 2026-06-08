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
- `deno task test` — Tier 1: hermetic unit suite (`deno test -A`)
- `deno task it` — Tier 2: headless integration against a throwaway local CSS (no creds)
- `deno task e2e:local` — Tier 3: Playwright UI specs against a throwaway local CSS (no creds)
- `deno task e2e:remote` — Tier 4: the same Playwright UI specs against real Pods (`testDir: test/e2e`)
- `deno run -A npm:eslint .` — lint (ESLint flat config in `eslint.config.js`; ignores `dist`)

The test foundation is tiered and provider-aware — see `test/README.md`. Four tiers
climbing fake→real one axis at a time: **Tier 1** (unit) lives next to the code as
`src/**/*.test.ts`; **Tier 2** (`test/headless/`, `deno task it`) runs the real
data-layer fns over two client-credential sessions against a local Community Solid
Server; **Tier 3** (`deno task e2e:local`) drives the real browser UI against a
throwaway local CSS, credential-free (the `local` Playwright project, `E2E_LOCAL=1`,
which also serves the production build — Tier 4 uses the dev server); **Tier 4** (`test/e2e/`,
Playwright, `deno task e2e:remote`) runs those same UI specs against real Pods. Both
tiers use **two roles, A = Alice and B = Bob** (solo specs → Alice; sharing specs →
Alice + Bob); for Tier 4 you configure each role's Pod/WebID per run by `source`-ing
an env file (`test/.env.e2e.*.local`). Shared provider/account config is in
`test/config/`. Each Praxishandbuch task is checked "in principle" (Tier 2) and "in
practice" (Tiers 3 local, 4 remote); each adjacent tier pair bisects a different
failure class (UI/render vs provider/server-interop).

Tier-1 tests use **offline fixtures** — e.g. `TurtleParsingService.test.ts` drives
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
- `VITE_POD_APP_DIR` selects the on-Pod app collection segment (default `granergize`).
  Every app resource lives under `<storageRoot><VITE_POD_APP_DIR>/`; the single source
  of truth is `APP_DIR` / `appRoot(webId)` in `solidUtils.ts` (and `podResources`), so
  all path builders move together. The e2e runs write to a throwaway collection so
  they never touch real `granergize/` data: Tier 3 bakes a fixed `granergize-e2e`
  into the build (its local CSS is wiped per spec), while Tier 4 (real Pods) writes
  to a per-run `granergize-e2e-<uuid>` — generated in `playwright.config.ts` and
  served by a freshly-started dev server (so `reuseExistingServer` is off for Tier
  4). A unique segment per run means leftover/stuck resources from an earlier run
  (e.g. a Pod request that hung mid-cleanup) can't impede a fresh run, so there is
  no reset step. Set `VITE_POD_APP_DIR` explicitly to target a specific collection.

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
   selector composing `useBuildings` (phase 1: buildings, paints the map) and
   `useEnergy` (phase 2: energy, dependent on phase 1). The single
   `QueryClient` lives in `src/context/QueryProvider.tsx`, which centralizes error
   routing (`SessionExpiredError` → warning, `ConflictError`/else → error) and
   `keepPreviousData` (a failed refetch keeps the last good data on screen). Freshness
   is server-driven (`staleTime: 0` + conditional GET via `fetchFresh`); the only
   refetch trigger is a write — mutations in `src/hooks/mutations.ts` invalidate their
   own query keys (`queryKeys` in `queries.ts`).
3. **Fetch + parse** — `src/services/TurtleParsingService.ts` orchestrates loading.
   There is no registry: it discovers the user's OWN buildings by *listing* the
   `granergize/buildings/` container for top-level `*.ttl` files (a single PUT adds a
   building, so the listing can't desync), and buildings shared *with* the user by
   folding the `shared-in/` event log. It fetches those sources with per-source
   blank-node scoping to avoid ID collisions, then delegates to parsers in
   `src/services/utils/` (`buildingParser`; energy via `parseEnergyDataset` in
   `energyDataset.ts`; user-energy readings via `parseTtlReadings` in `userEnergyParser`).
   Inaccessible shared sources are tolerated and pruned from the log; hidden buildings
   come from `gran:hiddenBuilding` triples in `<appRoot>/prefs.ttl` (see `prefs.ts`;
   the old standalone `hiddenBuildings.ttl` was folded into prefs).

### Operations — queries & mutations
Following **Command–Query Separation**, every Pod operation is either a **query**
(reads state, returns it, no side effect) or a **mutation** (changes state) — the
vocabulary the data layer already uses (`src/hooks/queries.ts` vs
`src/hooks/mutations.ts`). A function shaped like a query must not hide a mutation; the
two known exceptions (`loadBuildings`, `drainInbox`) are documented in
`notes/operations.md` (§Seams).

Every Pod mutation uses one of **three mechanisms**, and the rule for which is:
**event-source anything cross-agent or needing an audit trail / replay; overwrite
single-writer owned state in place; treat enforcement artifacts as projections of
the event log.** A new mutation should land in the right model *by this rule*, not by
copying whatever the nearest function happened to do.
- **Model 1 — event-sourced append.** Immutable events POSTed to an append-only LDP
  container (server mints the child IRI, so concurrent appends never clobber),
  *folded* on read to derive current state. The log is ground truth. Used for
  cross-agent / auditable state: the `shared-out/` & `shared-in/` sharing logs, the
  `rooms/<id>/` membership+role logs, the inbox notifications.
- **Model 2 — in-place mutation.** GET → mutate → conditional PUT (`readModifyWrite`,
  If-Match); the resource *is* the state, no history. Used for single-writer owned
  data: building files & energy datasets, `prefs.ttl`/`bookmarks.ttl`/`contacts.ttl`,
  view definitions/snapshots, the WebID profile/org node.
- **Model 3 — ACL projection.** WAC `.acl` files are not ground truth; they are an
  enforcement cache rebuilt from the `shared-out/` log (`reissueGrants` →
  `applyBuildingGrant` → `grantReadAccess`/`removeFromACL`). Writes the `.acl` at the
  call site but the authoritative record is the model-1 event — keep it replayable
  (see Sharing/interop below).

Orthogonally, mutations split by **trigger**: most are *user-intent* (a person decided);
a few are *reconciliation* (system-initiated to make a projection match reality — the
stale-grant prune in `loadBuildings`, the ACL rebuild in `reissueGrants`), which is why
those legitimately live in query/restore paths. `notes/operations.md` is the full
taxonomy, mapping each operation to its model.

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
- The Granergize **ontologies themselves** (the gran / investor / benchmark / user
  vocabularies, one per namespace) are versioned in `vocab/` — the repo is their source
  of truth (see `vocab/README.md`); the documents on the Pod are a publish target, and the
  app never fetches them at runtime. `vocab.test.ts` asserts every owned field-schema
  predicate, object-property range, and controlled-vocab instance is defined there, so the
  code and the published vocab can't drift.
- Predicate→`BuildingType` field mappings live in
  `src/services/utils/config/buildingConfig.ts`. Each field carries its `rdfs:range`
  (an XSD datatype → typed literal; `foaf:Agent` → IRI reference; another class IRI →
  controlled-vocab object); `predicateMap`/`objectPropertyMap`/`iriPropertyMap` and the
  datatype sets all derive from it. Adding a building property generally means updating
  both `BuildingType` and this table (and defining the term in `vocab/`).
- RDF parsing/serialization uses `n3` (`Parser`, `Store`, `Writer`, `DataFactory`).
  Shared quad helpers are in `src/services/utils/rdfHelpers.ts`.
- **Storage root** — `resolveStorageRoot(session)` (`solidUtils.ts`) resolves it the Solid
  way: read `pim:storage` from the WebID profile, else walk up to the `pim:Storage`-typed
  container (so Pods that type the root but omit the triple still work); cached per WebID.
  `getStorageRoot(webId)` is the sync accessor; `resolveStorageRootForWebId(webId, session)`
  resolves an *arbitrary* (e.g. share-recipient) root. `podResources(webId)` builds the
  `granergize/` paths from it. Handle subdomain- and path-based Pods via these, not WebID
  string-munging.
- Read the user's WebID profile via `loadProfileStore` (`profileDocument.ts`), not a bespoke
  fetch: it caches the parsed profile per session so storage-root / org / avatar reads share
  one GET (call `invalidateProfile` after writing the profile). Mutable Pod reads go through
  `fetchFresh` (`podFetch.ts`), which now revalidates (`cache: "no-cache"`, so 304s work) —
  no `?t=` URL cache-buster. Freshness across writes is otherwise owned by React Query.

### Key feature areas
- **Routing** — `src/App.tsx` defines hash routes: `/`, `/building/:id`,
  `/energy/:id`, `/view/:viewId`. Wrapper components resolve params against context data.
- **Sharing/interop** — `src/services/interop/` implements building sharing between Pods
  via append-only `shared-out/`/`shared-in/` logs and an **app-scoped inbox** (`inbox.ts`).
  The inbox is `<storageRoot>/granergize/inbox/` (NOT the agent-global `/inbox/`), discovered
  by reading `ldp:inbox` from the `granergize/` root (body or Link header) with the
  convention path as fallback. `ensureOwnInbox(session)` self-provisions it at login
  (container + append ACL + discovery pointer), so the app works on bare Pods that aren't
  pre-wired with an inbox. Access-grant logic in `sharingManager.ts`.
  **The `shared-out/` event log is the ground truth of sharing; the WAC `.acl` files
  are a derived projection** — every share dimension must be recorded *in the event*
  (e.g. a per-year grant's years via `interop:includesEnergyYear`) so the log stays
  self-sufficient. The ACL side is split out as `applyBuildingGrant` (ACL-only, no
  inbox/log side effects) so `reissueGrants(session)` can fold the log and rebuild
  the ACLs — used after an archive restore (which captures the log but not the
  `.acl`) and as a sharing repair/audit. Replay is same-Pod only (the log holds
  absolute IRIs; off-Pod grants are skipped). Keep this replayable.
- **Aggregated views** — `src/services/aggregation/` (`viewManager` persists view
  definitions/snapshots as Turtle in the Pod; `viewComputer` computes them).
- **Data integration** — `AddBuildingDialog.tsx` + `buildingSerializer.ts` import buildings
  from XLSX templates (`public/templates/`, parsed with `xlsx`) and serialize to Turtle.

### UI stack
MUI v6 (`@mui/material`, Emotion) with a custom theme in `src/theme.ts`. Charts use
[Recharts](https://recharts.org/) — chart components (`MetricLineChart.tsx`,
`MetricBarChart.tsx`); `vite.config.ts` chunks `recharts`/`d3-*` into a `vendor-charts`
bundle. Maps use Leaflet via `react-leaflet`.
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
`endActivity(id, { status | error })` records each outcome. The inline request URIs and
the clickable log are a **Developer-mode** affordance (see UI conventions): outside dev
mode the indicator is a plain spinner and `RequestActivityList` renders nothing.

The header indicator's debug log (enable Developer mode, then click the network indicator)
is the in-app way to audit what the app fetches end-to-end — status, pod-relative path,
and per-hit timing.

**Loading-spinner policy: the header indicator is the ONLY loading spinner inside the
app shell.** Don't add component-level `CircularProgress`/`LinearProgress` for network
loads — feed the activity store instead. During an in-flight load a region stays blank
(or shows a plain "Loading…" text), and action buttons go `disabled` (no inline
spinner) to prevent double-submit. The exceptions, which keep a local spinner because
the header isn't mounted there, are the standalone full-page routes
(`/building`, `/energy`, `/view/:id`, `/room/:uri` — see `App.tsx`,
`AggregatedView.tsx`), the pre-auth `Login` screen, and the lazy-chunk
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
- **Developer mode — one gate for raw/debug affordances.** A client-only,
  `localStorage`-persisted flag (pure store `services/utils/devMode.ts` +
  `useDevMode()` in `components/devMode.ts`, mirroring the
  `networkActivity`/`requestActivity` split), toggled from the footer. It gates
  everything that exposes RDF/Solid plumbing rather than user content, and is OFF
  by default. Gated by it: the `RdfSourceLink` raw-RDF source links (the component
  **self-hides** outside dev mode, so it's the one-call way to add a dev-only
  source link — prefer it over a bespoke `UriLink` for any backing-resource link),
  the in-list resource IRIs (building URIs, the energy dataset + weather adapter
  links), the dev-only "Your inbox" / "Outgoing shares" sections, the Share-tab
  "Check for new shares" button (manual inbox drain), the "Add demo buildings" /
  "Download archive" / "Upload archive…" / "Rebuild sharing from log" / "Remove all
  app data…" account actions, and the request log (`RequestActivityList` renders
  nothing outside dev mode; the header `NetworkActivityIndicator` collapses to a
  plain spinner — no inline URIs, no clickable log). WebIDs and data-room invite
  IRIs are identity/links, not raw storage, so they stay visible in both modes.
  When adding anything that surfaces an IRI/container or a debugging view, gate it
  on dev mode.

When a new widget seems necessary, first check whether an existing
component/pattern covers it; prefer extending the shared one over adding a
single-use variant.
