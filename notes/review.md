# App Review — Granergize WebApp

Date: 2026-06-05. Branch: `dev-aha`. Scope: ~22k LOC, 115 TS/TSX files, 28 unit-test
files, 14 Playwright e2e specs. Reviewed by parallel per-dimension agents; findings
below were spot-verified against the code.

Severity scale: CRITICAL (ship-blocker / data-loss / security) · HIGH (should fix soon)
· MEDIUM (fix when touching the area) · LOW (cleanup / watch-list) · INFO (confirmed
strength or non-issue).

## Executive summary

The codebase is, for its size, **well-disciplined and unusually well-documented**: clean
hooks → services → parsers layering with no dependency cycles, coherent React Query usage
(WebID-namespaced keys, event-driven freshness, precise mutation invalidation), zero
`any`/`@ts-ignore`/TODO debt in source, a green 179-test offline suite, and
ESLint-enforced UI conventions that are genuinely upheld. The RDF/Solid domain core —
the part the author cares most about — is sound.

The real risks are concentrated and few:

1. **CI deploys to a live host on every push while running none of the suite** — no
   tests, no lint, no typecheck (CRITICAL).
2. **ACL grant/revoke is racy and non-idempotent** — unconditional GET, string-concat,
   PUT; duplicates and clobbers (HIGH).
3. **`xlsx@0.18.5` has known high-severity CVEs, is unmaintainable on npm, and the
   user-upload parse path is reachable** (CRITICAL/dependency).
4. **A module-global `activeRoom` is not WebID-scoped and survives re-login** (HIGH).
5. **Documentation drift**: CLAUDE.md describes a Chart.js stack that no longer exists
   (it's Recharts) (HIGH-doc).

Everything else is maintainability and hardening: one 1,555-line god-file, duplicated
dialog helpers, a couple of UI-logic leaks into the service layer, hand-built Turtle
strings, and a scheme allowlist missing on rendered IRIs.

## Top priorities (recommended order)

1. **Gate CI before deploy** — add `deno task test`, `deno task lint`, and a real
   `tsc --noEmit` as jobs; `deploy: needs: [build, test, lint, check]`. Low effort,
   highest leverage.
2. **Fix `xlsx`** — move to the SheetJS CDN tarball ≥0.20.2 (clears both CVEs), or
   migrate the parse path off `xlsx`. Verify the URL spec resolves under Deno.
3. **Make ACL writes safe** — route grant/revoke through the existing
   `readModifyWrite` (parse store, add/remove by `acl:agent`, idempotent on re-grant).
4. **Reset cross-user state on logout** — clear `activeRoom`, `queryClient.clear()`,
   and `storageRootCache` on logout / session-expiry.
5. **Fix the chart-library docs** in CLAUDE.md (Chart.js → Recharts; drop the
   `chartSetup.ts` / chart.js-dedup claims).
6. **Add a `safeHref()` scheme allowlist** to `UriLink` so untrusted shared-Pod IRIs
   can't render a `javascript:` link.
7. **Cover `viewComputer` and the energy/agent parsers** with offline-fixture tests.

---

## Architecture & Data Flow

Overall: **good.** Layering holds (services import nothing from hooks/pages/components),
no dependency cycles, React Query design is coherent, and failure-mode handling
(tolerated/pruned inaccessible sources, 401→`SessionExpiredError`, retry/throttle) is a
genuine strength.

- **HIGH — `activeRoom` module singleton is not WebID-scoped and never reset on logout.**
  `let activeRoom` (`dataRoom.ts:77`), read synchronously by `getActiveRoom()` and used
  by `BuildingDialogs.tsx` / `ShareViewDialog.tsx`. Cleared only on explicit room
  exit/remove (`dataRoom.ts:158,198`); `handleLogout`/`sessionExpired` in `main.tsx`
  never reset it. Unlike the WebID-namespaced React Query cache, this bare string
  survives a logout→login-as-different-user in the same tab, so a sharing dialog can
  briefly target the previous user's room. Fix: export a `resetActiveRoom()` and call it
  where `clearRequestLog()` is called (`main.tsx:76,115`), or derive current-room from
  React Query.
- **MEDIUM — React Query cache and `storageRootCache` not cleared on ordinary logout.**
  `gcTime: Infinity` (`QueryProvider.tsx:49`); `handleLogout` (`main.tsx:108`) only does
  `session.logout()` + `clearRequestLog()`. `queryClient.clear()` runs only on the
  destructive "remove all data" path (`index.tsx:235`). WebID-keying prevents *reading*
  stale data, but the previous user's data stays resident in memory until tab close
  (privacy/footprint on shared machines). Fix: `queryClient.clear()` +
  `storageRootCache.delete(webId)` on logout and session-expiry.
- **MEDIUM — Business logic (raw fetch + RDF parse) leaks into the UI in `SharePage.tsx`.**
  `SharePage.tsx:183-189` calls `session.fetch(...)` and `new Parser()` directly,
  bypassing `fetchFresh` (no 304 revalidation) and the network-activity instrumentation.
  The one place RDF parsing escaped `src/services`. Fix: move `loadSharedBuilding` into a
  service that uses `fetchFresh`.
- **MEDIUM — UI side effect (`globalThis.confirm`) embedded in the service layer.**
  `buildingActions.ts:40` (and `index.tsx:216`) block on `globalThis.confirm`; can't be
  unit-tested without a DOM stub and bypasses the `Modal.tsx` convention. Fix: lift the
  confirm into the calling component, keep the service pure.
- **LOW — `useRooms` "fetch once, never refetch" invariant is not encoded defensively.**
  Relies on `refetchOnMount:false` + no invalidation; no `staleTime: Infinity`. A stray
  `invalidateQueries(["rooms"])` would refetch and could revert an optimistic switch.
  Fix: add explicit `staleTime: Infinity`.
- **LOW — "agents" are vestigial but still threaded through.** `loadBuildingsAndAgents`
  always returns `agents: []` (`TurtleParsingService.ts:263`), yet `AgentType`, the
  `/agent/:id` route, and `agentAverages` plumbing remain. Decide: restore or excise.
- **INFO (strength)** — No upward/cross-layer dependency cycles; routing param
  resolution centralized in `BuildingRouteGuard`; error→notification routing pure and
  tested (`queryErrors.ts`).

## Code Quality & Maintainability

Overall: **maintainable and well-disciplined.** ESLint passes (0 errors, 4 cosmetic
warnings); zero `any`/`@ts-ignore`/`@ts-expect-error` in source; zero `as unknown`
outside tests; zero TODO/FIXME/HACK markers.

- **HIGH — `buildingSerializer.ts` (1,555 lines) is a god-file spanning ~6 unrelated
  concerns**: timezone/DST math (`lastSundayOf`/`berlinToUTC`, 111-127), XLSX Lastgang
  parse (`parseLastgangXlsx`, 206), Turtle serialization (483), Pod I/O
  (upload/update/delete, 750-833), geocoding (935), demo seeding (984), CSV→fields
  (1143-1356), workbook export (1398-1553). 43 functions in one module. Fix: split along
  the existing seams (`energySeriesXlsx.ts`, `buildingTurtle.ts`, `buildingPodOps.ts`,
  `buildingWorkbook.ts`, `geocode.ts`), keep a thin re-export.
- **MEDIUM — Form-field render helpers copy-pasted between dialogs.** `tf`, `check`,
  `enumSelect`, `sectionHeader` are near-identical in `AddBuildingDialog.tsx:374-441` and
  `EditBuildingDialog.tsx:129-180`. Fix: extract shared `buildingFields.tsx` components.
- **MEDIUM — Hand-built Turtle via string concatenation bypasses n3.**
  `generateEnergyDayTtl` (`buildingSerializer.ts:278-309`) and `@prefix` string blocks in
  `energyDataset.ts:194-199`, `viewManager.ts:29-31`, `sharingLog.ts:94-98` interpolate
  values into Turtle. Safe today (numeric/ISO values), but a `label` with a quote/newline
  would break the document — and it contradicts the project's own "use n3 Writer" rule.
  Fix: build with `Store` + `Writer` (reuse `viewManager`'s `serializeWithPrefixes`), or
  route literals through a shared escape helper.
- **MEDIUM — Inline IRI literals duplicate `vocabularies.ts` constants.** XSD datatypes
  redefined locally (`buildingSerializer.ts:56-58`, `prefs.ts:15`), LDP `contains`/`inbox`
  hardcoded (`inbox.ts:35,111,135`, `dataRoom.ts:25`, `podDelete.ts:6`), ACL `agent`
  (`sharingManager.ts:163`), `rec#Building`/`rec#agent` (`buildingParser.ts:114`,
  `agentParser.ts:8,12`). Fix: promote to `vocabularies.ts` (`LDP_CONTAINS`, `LDP_INBOX`,
  `ACL_AGENT`, `REC_BUILDING`, `XSD_STRING`, `XSD_BOOLEAN`). (The `buildingConfig.ts`
  predicate table is arguably the canonical mapping and may stay.)
- **LOW — Debug `console.log` in a production write path** —
  `certificateUploader.ts:34,51,56` (progress chatter; the header indicator already shows
  request progress). Remove.
- **LOW — Silently swallowed errors collapse "empty" and "failed."**
  `sharingManager.ts:63,95,362,391`, `viewManager.ts:254,278,482` `catch { … return [] }`,
  so a network/parse failure looks like "no data" with no notice. For React-Query-driven
  reads, rethrow so QueryProvider routes the error; where the fallback is intentional,
  comment the empty-on-error contract.
- **LOW — ESLint warnings (4, cosmetic):** `react-refresh/only-export-components`
  (`NotificationContext.tsx:71`, `main.tsx:39,196`), and an `exhaustive-deps` for missing
  `loadViewData` (`AggregatedView.tsx:65`) — verify it isn't a stale-closure bug.
- **Watch-list:** `dataRoom.ts` (616), `ManagePage.tsx` (586), `ExplorePage.tsx` (555),
  `viewManager.ts` (525), `CreateViewDialog.tsx` (525) are large but cohesive — fine for
  now.

## RDF / Solid Correctness

Overall: **strong.** IRIs resolved the Solid way (`pim:storage`, no WebID munging),
behaviour dispatches on data shape (`isSeriesGranularity`) and never on
provenance/role, cross-source blank-node scoping is collision-free, PUT/POST-only writes
with append-only LDP logs are implemented as documented.

- **HIGH — ACL grant/revoke is racy and accumulates duplicate/orphaned authorizations.**
  `grantReadAccess` (`share.ts:138-176`) does a plain GET of `<resource>.acl`,
  *string-concatenates* new Turtle, and PUTs back — no `If-Match`, no parse, no dedup.
  `removeFromACL` (`sharingManager.ts:144-189`) is GET→parse→PUT, also unconditional. Two
  concurrent shares (or share racing revoke) clobber each other (last PUT wins);
  re-sharing the same WebID appends a duplicate `#Read_<webid>` block; revoke-after-two-
  grants leaves dangling triples. The one place writes bypass the optimistic-lock pattern
  the rest of the code uses. Fix: route ACL edits through `readModifyWrite`, idempotent
  on re-grant.
- **MEDIUM — `updateBuilding` (edit path) never updates blank-node substructures.**
  `buildingSerializer.ts:775-818` rewrites only scalar/object/geo fields; operating
  costs (`_opcost_*`), certifications (`_cert_*`), and `provenance` are not handled, so
  edits to those are silently dropped. Create-path round-trip fidelity (well-tested) does
  not extend to edits. Fix: replace-rewrite those blank nodes like `replaceGeoPoint`, or
  document edit as scalar-only.
- **MEDIUM — XLSX export→import is lossy for object-property fields.** The parser stores
  object properties as *labels* (e.g. `tenancyType: "Single Tenant"`). The generic export
  writes the label; generic re-import (`parseCsvToFields`, line 1339) applies no
  normalization (only investor/BSP templates run `applyNormalization`), so the serializer
  emits `investor:tenancyType investor:Single Tenant` — an invalid IRI with a space. The
  investor round-trip is tested and works; the generic path isn't. Fix: add a round-trip
  test for the generic path; normalize labels back to local names, or export local names.
- **LOW — `isSeriesGranularity` regex is dead/misleading.** `durationUtils.ts:9-15`
  reduces to `startsWith("PT")` (the captured-minutes group is never used; `"PTxyz"`
  classifies as a series). Harmless today. Simplify.
- **LOW — `parseDatasetSlug` is brittle.** `energyDataset.ts:152-166` splits on the first
  `-`; a future granularity token containing `-` (or non-prefix year) mis-parses. Keep
  the constraint documented.
- **LOW — `extractBuildingIdStrict` guards `#building<N>` fragments but not canonical
  `/buildings/<id>.ttl` paths** (`buildingParser.ts:44-69`). An owned and a shared
  building sharing a file basename would merge in `parseBuildings`. Fix: incorporate the
  source/doc URL into the canonical-path id, or key the map on the subject IRI.
- **LOW — ETag conditional read/write is correctly implemented but inert in production.**
  `podWrite.ts:79-95` reads `ETag` and guards PUT with `If-Match` (tested), but
  solidcommunity.net GETs return no ETag, so every RMW degrades to a blind PUT — the
  append-only LDP logs are what actually deliver race-freedom. The ACL writes (HIGH
  above) are the exposed surface because they use neither the append pattern nor a
  working lock. (Confirms the prior room-switch/ETag note.)
- **INFO** — Provenance/role separation holds (no behaviour keys off provenance; export
  template selection on `b.provenance` is the documented template use, not dispatch).
  Lastgang timezone handling is locale-correct (explicit Europe/Berlin DST, UTC storage,
  Excel-1900-leap handled). `agentParser` uses `https://schema.org/name` vs
  `buildingConfig`'s `http://schema.org/...` — acknowledged in a comment, intentional.

## Testing & SE Practices

Overall: **good intentions, weak enforcement.** Offline-fixture discipline is genuine
(stateful Pod fakes with real LDP semantics, behavioural assertions); suite is green
(`179 passed | 0 failed`). Undermined by a hollow CI gate.

- **CRITICAL — CI deploys without running tests, lint, or typecheck.**
  `.github/workflows/main.yml`: `deploy: needs: build`, and `build` is just
  `deno install && deno task build`. Nothing runs `deno task test` (179 tests) or
  `deno task lint`, and `deploy` doesn't even depend on the `e2e` job. A regression that
  breaks tests/lint still ships to the live host. Fix: add `test` + `lint` gating jobs;
  `deploy: needs: [build, test, lint]`.
- **CRITICAL — No typecheck anywhere in the pipeline.** `build` is `vite build`
  (esbuild strips types without checking). `tsconfig.app.json` is strict but only the IDE
  consults it. A type error the editor didn't surface compiles and deploys. Fix: add a
  `check` task (`tsc --noEmit -p tsconfig.app.json`, run via Node tsc not `deno check`)
  and gate CI on it. (Note: current `src/` type-clean status is unverified by this
  review — `deno check` reports false positives from lib mismatch.)
- **HIGH — Only 1 of 14 e2e specs runs in CI; the other 13 need live Pods and are
  flaky.** `smoke.spec.ts` is the sole no-login spec; the rest `test.skip` without
  `E2E_*` creds, so CI exercises only the logged-out sign-in screen. `workers:1` +
  `retries:1` exist specifically to absorb solidcommunity.net Cloudflare 429/503/CORS
  (matches the known environmental-flakiness note). Fix: stand up a disposable Community
  Solid Server container in CI and run the credentialed suite against it deterministically
  (the specs already stub Nominatim and self-clean).
- **MEDIUM — High-risk data-layer modules have no unit test.** Notably
  `aggregation/viewComputer.ts` (452 lines — the engine that *computes* views; only its
  persistence sibling is tested), the parsers `energyDataParser.ts`,
  `userEnergyParser.ts`, `agentParser.ts`, plus `interop/inbox.ts`, `interop/share.ts`,
  and `hooks/mutations.ts` (the write path). Fix: add offline-fixture tests for
  `viewComputer` (deterministic input → expected aggregate) and the three parsers first.
- **LOW — Commit hygiene is the weak spot.** Feature branch is good, but recent messages
  are vague (`next iteration`, `next batch`) and commits are large mixed bundles
  (`941f3a7 next iteration, excel import/export`), making bisect/review hard. Env handling
  is otherwise clean (tracked `.env.*` carry only the public weather URL; secrets
  gitignored). CHANGELOG.md is unusually detailed.

Coverage map — **tested well:** buildingSerializer, buildingParser,
TurtleParsingService, sharingManager, sharingLog, viewManager, dataRoom,
organizationManager, energyDataset, durationUtils, solidUtils, profileDocument,
podWrite/podDelete, retryFetch, prefs, bookmarks, and the hooks (queries, queryErrors,
roomState). **Untested / high-risk:** viewComputer, energyDataParser, userEnergyParser,
agentParser, inbox, share, mutations, buildingActions, certificateUploader, podFetch,
rdfHelpers.

## Libraries & Dependencies

Overall: **moderate, with one must-fix.** Mostly current; chunking/lazy-loading is
thoughtful. No license red flags (MIT/Apache-2.0 throughout).

- **CRITICAL — `xlsx` pinned `0.18.5` (npm) has known high-severity CVEs, is
  unmaintainable on npm, and the parse path is reachable.** `package.json:29`. Parses
  user-uploaded files via `XLSX.read(...)` (`buildingSerializer.ts:1232`), reached from
  the file input in `AddBuildingDialog.tsx` (`accept=".csv,.xlsx"`). 0.18.5 is affected by
  prototype-pollution CVE-2023-30533 (fixed 0.19.3) and ReDoS CVE-2024-22363 (fixed
  0.20.2); fixed versions are **not on npm** (SheetJS ships only from cdn.sheetjs.com).
  Fix: `"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"` (verify it resolves
  under Deno), or migrate the parse path to `exceljs`. Treat uploaded workbooks as
  untrusted until then.
- **HIGH (doc) — CLAUDE.md is stale about charts; the stack is Recharts, chart.js is
  gone.** Zero `chart.js`/`chartjs`/`chartSetup` references in `src`/`vite.config.ts`;
  `recharts` (`package.json:27`) is imported in `MetricLineChart.tsx:10` /
  `MetricBarChart.tsx:11`, and `vite.config.ts:17` chunks `recharts`/`d3-` as
  `vendor-charts`. The "vite dedupes chart.js" claim is also stale. Fix the CLAUDE.md "UI
  stack" section (no code change). No redundant chart libs installed — good.
- **MEDIUM — `@wintechis/wetterdienst-rdf-adapter` `jsr:^0.0.53` is a pre-1.0
  single-author dep**, and `^0.0.x` floats across breaking 0.0.x releases. Also partly
  redundant with the prod HTTP adapter (`vite.config.ts:34`). Fix: pin exactly `0.0.53`;
  confirm whether the runtime path needs the lib vs. the HTTP adapter.
- **MEDIUM — Two lockfiles for two package managers.** `pnpm-lock.yaml` (Feb) +
  `deno.lock` (Jun) both present; `package.json` pins `pnpm@10.13.1` while tasks run on
  Deno. Divergent locks can resolve different transitive versions. Fix: pick one (Deno is
  documented → keep `deno.lock`, drop `pnpm-lock.yaml` + `packageManager`), or at least
  regenerate the pnpm lock.
- **LOW — `html5-qrcode` (low-activity) is lazy-loaded only when the camera opens**
  (`QrScanner.tsx:39`, kept out of the eager chunk) — right mitigation, keep as-is.
  `qrcode.react@4.x` is current. `leaflet-defaulticon-compatibility` is an abandoned-but-
  stable 10-line shim; optionally inline it.
- **LOW — Major-version currency (no security pressure; defer/coordinate):** React
  `^18.3.1` → 19 (gated by MUI/react-leaflet; defer), MUI `^6` → 7 (do with React 19),
  `react-router-dom` `^6.27` → 7 (low priority; HashRouter-on-subpath needs testing),
  Vite `^5.4` → 6/7 (worth doing eventually, verify under Deno). `@tanstack/react-query`,
  `n3`, `@inrupt/solid-client*` are current — no action.
- **LOW — Bundle weight is actively managed but unmeasured.** `vite.config.ts` splits
  MUI+emotion, recharts+d3, leaflet, @inrupt; `ExplorePage` is route-lazy. `xlsx` loads
  eagerly in the generic `vendor` chunk though it's only needed for import/export — a
  lazy-load candidate (mirror the html5-qrcode pattern). Add `rollup-plugin-visualizer`.

## UI/UX & Design Consistency

Overall: **strong adherence** to the documented conventions — dialog/spinner/notification
rules are followed and ESLint-enforced.

- **INFO (compliant)** — All dialogs route through `Modal.tsx` (zero raw
  `@mui/material/Dialog` imports). `CircularProgress` confined to the documented
  full-page-route / Suspense exemptions + the one header spinner. Notifications via
  `showNotification`/`formatError`; `<Alert>` use is all inline/contextual as permitted.
- **MEDIUM — Hardcoded hex colors / one inline `fontSize` outside the theme.**
  `constants/chartColors.ts:21,24,27`; `Energy.tsx:131,134` (`alpha("#a5d6a7"…)` /
  `alpha("#ef9a9a"…)` — comments say they mirror `success.light`/`error.light` but are
  inlined and will drift); `index.tsx:339` (`rgba(0,0,0,0.32)`); `ManagePage.tsx:423`
  (`fontSize: "0.8rem"` — the lone inline `fontSize`). Fix: pull `Energy.tsx` colors from
  the theme palette; move marker colors into the theme or document as a chart-palette
  exception; replace the `fontSize` with `variant="caption"`.
- **LOW — Icon-button accessibility is broadly good but not uniform.** Several use
  `title=` on the IconButton instead of wrapping in `<Tooltip>` (e.g.
  `ManagePage.tsx:265`) — functional (native tooltip + accessible name) but inconsistent
  with the documented `<Tooltip>` + `aria-label` pattern. Spot-check found no missing
  accessible names, but ~57 IconButtons weren't all audited.
- **LOW — Minimal responsive design.** `useMediaQuery`/breakpoints only in `Login.tsx`,
  `NetworkActivityIndicator.tsx`, `ExplorePage.tsx`; `theme.ts` defines no custom
  breakpoints. Table-heavy pages (`ManagePage`, `SharePage`) may not adapt to narrow
  viewports — verify via Playwright. `theme.ts` itself is clean.
- **LOW — In-button `CircularProgress size={20}`** on `AggregatedView.tsx:214,372`
  deviates from the "disabled, no inline spinner" rule, but on an exempted full-page
  route. Optional.

## Security & Robustness

Overall: **no CRITICAL/HIGH issues.** No `dangerouslySetInnerHTML`; the one HTML-string
sink (Leaflet marker) uses only trusted constants. Auth/session, retry/backoff,
file-error handling, and external-service trust are sound.

- **MEDIUM — Untrusted IRIs from shared Pods render as link `href` with no scheme
  allowlist.** `UriLink` (`DetailView.tsx:160`) passes `href` straight to MUI `<Link>`;
  the parser preserves the raw subject IRI into `building.uri` (`buildingParser.ts:112`),
  fed from other users' shared data (`Building.tsx:139,146`, `Energy.tsx:258`,
  `Agent.tsx:67`, `SharePage.tsx:273`, `ConnectPage.tsx:232`). A shared building whose
  subject IRI is `javascript:…` would render a clickable one-click-XSS link
  (`target="_blank"` + `rel="noopener"` do not neutralize `javascript:`). Verified: no
  scheme guard exists; the IRI reaches the href unfiltered. Fix: a `safeHref()` helper
  that allowlists `http`/`https`/`mailto` and otherwise renders plain text, applied inside
  `UriLink`.
- **LOW — Working-tree env files hold live-looking passwords.** `.env.e2e.local` and
  `.env.e2e.local~` contain plaintext creds for solidweb.org / solid.redpencil.io /
  solidcommunity.net accounts. **Correction to the reviewer:** both *are* gitignored —
  `.env.e2e.local` via `.env.*.local` and `.env.e2e.local~` via the separate `*~` rule
  (`.gitignore:42`) — so `git add -A` would **not** stage the backup; the "trailing `~`
  defeats the pattern" claim is false. Residual: the creds were read into this review
  session, so rotating them is prudent; consider deleting the `.local~` backup.
- **LOW — Leaflet `divIcon` builds HTML by string interpolation** (`ExplorePage.tsx:82-86`)
  but only from trusted build-time constants — not exploitable now. Add a comment or
  build via DOM to prevent a future regression if building data is ever interpolated.
- **LOW — Retry wrapper is correct and bounded** (`retryFetch.ts`, `attempt < maxRetries`,
  exponential backoff, honors `Retry-After` delta-seconds). Two minor gaps: no jitter
  (concurrent throttled requests retry in lockstep and re-burst), and `Retry-After`
  HTTP-date form isn't parsed (falls back to backoff — acceptable). Add jitter.
- **LOW — Logout is well-considered** (app + idp paths, `NO_RESTORE_KEY` blocks silent
  auto-restore, tokens managed by `@inrupt` not hand-rolled). Residual: `localStorage
  "prevIdps"` persists issuer URLs across logout by design (not sensitive; has a clear
  button).
- **INFO** — Geocoding (Nominatim) and weather endpoints are hardcoded HTTPS with
  `encodeURIComponent`; responses parsed as data, not HTML. `formatError` doesn't
  interpolate tokens. Acceptable.
