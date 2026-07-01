# Tests

Every run is placed by **three orthogonal axes** — the old linear "Tier 1..4" only
named a diagonal through the first two:

- **kind** — how much of the stack runs: `unit` → `headless` → `e2e`.
- **backend** — where data comes from: `local` (hermetic) vs `remote` (online). The
  backend has **two independent parts**: the authed **Pod** (Solid server) and the
  read-only **external sources** (weather, the MaStR/OSM/INSPIRE/NUTS/LAU wrappers,
  `nominatim`, map tiles, Wikidata/Commons, and — for evals — the chat API). `local`
  fakes both; `remote` uses both real.
- **mode** — what the run yields: **assert** (pass/fail, the default), **measure**
  (benchmark numbers, §Benchmarks), **load** (the stress probe), **judge** (eval
  score, §Evals).

The lanes (`kind:backend`), each pinned to its current command. (The lane names are the
conceptual model; the deno tasks keep their historical names — `test`, `it`,
`e2e:local`/`e2e:remote` — until a planned rename lands, see
[`../plans/plan-test-lane-naming.md`](../plans/plan-test-lane-naming.md).)

- **`unit:local`** (`deno task unit:local`) — hermetic logic + RDF over in-memory fixtures
  (`src/**/*.test.ts`). Never does I/O — **provably**: the run reports 0 ignored, with no
  `LIVE` escape hatch (the old real-network Wikidata cases were relocated to
  `it:contract`, and the contract dir is `--ignore`d here). **There is no `unit:remote`.**
- **`headless:local`** (`deno task headless:local`) — real data-layer fns over a throwaway local CSS,
  actors A/B(/C), no creds (`test/headless/`). `it:jss` runs the same against JSS.
  *Hermetic on the Pod only:* its base resolvers are `import.meta.env`-only, so any
  external-source read still hits the real host until the planned `Deno.env` override +
  local stub land (§External sources).
- **`headless:remote`** (`deno task headless:remote`) — runs the **same task modules**
  against a **real** Solid server instead of the throwaway local one. Creds come from
  the **same `WEBID_<slot>_*` registry the e2e/bench lanes use** (`account(slot)`), so
  you just `source` any creds file (e.g. `test/.env.trio.local`) and run — no separate
  headless creds. Throwaway accounts only. The flow is account-API client-credentials +
  DPoP, so the account's provider must support it (`supportsClientCredentials` —
  solidcommunity, fraunhofer, …); a browser-OIDC-only provider throws a clear error.
  CSS is only one such server type. This is where the share/benchmark/contacts interop
  earns *real-provider* assurance (the local lane already proves the logic). Its **second,
  network-only flavour** is the external-host *contract* check (`deno task headless:remote:contract`,
  `test/headless/contract/`) — no Pod, no actors, a standalone Deno I/O test against a
  real host (the Wikidata-logo check, relocated out of the unit glob).
- **`e2e:local`** (`deno task e2e:local`) — full UI + OIDC against the same local CSS,
  credential-free, prod build (`E2E_LOCAL=1`). Hermetic on the Pod; **external reads are
  stubbed per-spec** via `page.route` (§External sources).
- **`e2e:remote`** (`deno task e2e:remote`) — the same specs against real Pods; `source`
  a `test/.env.e2e.*.local` creds file first.

Adjacent kinds isolate one failure class (data-layer → UI → provider interop). Three
roles, **A = Alice / B = Bob / C = Charlie**; the catalog specs split by pod count:
**solo** specs use A; **duo** (cross-Pod sharing) use A + B; **trio** (the
benchmark-service round-trip) use A + B + C. The specs live in a folder PER pod count —
`test/e2e/{solo,duo,trio}/*.spec.ts` (one per feature: login, organisation, add-building,
energy-entry, aggregations, data-room, share-building, share-aggregation) — so each
project's `testMatch` is just its folder glob and a new/renamed spec auto-registers by
location (no hand-maintained list to fall out of); `headless:local` mirrors a subset in
`test/headless/tasks/`. Shared config in `test/config/` (`providers.ts`, `accounts.ts`,
`actors.ts`).

```
deno task unit:local                                          # unit:local
deno task headless:local                                            # headless:local (no creds)
deno task e2e:local [test/e2e/solo/<spec>.spec.ts]      # e2e:local (no creds)
source test/.env.e2e.local && deno task e2e:remote      # e2e:remote (real Pods)
```

`e2e:remote` writes to a throwaway, **per-run** collection (`granergize-e2e-<uuid>`,
generated in `playwright.config.ts`) so leftover/stuck resources from an earlier run
can't impede a fresh one — there is no reset step. It runs serial (`workers: 1`) and
aborts on a Cloudflare 1015 rate-limit. The local-CSS lanes have a known
intermittent **JWKS boot race** (a freshly-booted CSS transiently 401s a
DPoP token until its key set warms) — not an app bug; mitigated by a boot warmup and
bounded retries.

## External sources — the second backend, faked per-kind

External read-only sources (weather `linked-wetterdienst`, `linked-regionalstatistik`
and the other geo/MaStR wrappers — see [`../notes/data-deref.md`](../notes/data-deref.md)
§External wrapper endpoints — plus `nominatim`, map tiles, Wikidata/Commons) are **not**
the Pod. They are the backend's second, independent part, and **each kind makes its
`local` cell hermetic by a different mechanism**:

- **`unit:local`** — an in-process fake `fetch` serves local fixtures; never any I/O.
- **`e2e:local`** — **`page.route`** intercepts the wrapper URL inside the spec and
  fulfills fixed Turtle/GeoJSON — per-spec, no rebuild, deterministic. (A global guard
  that *fails* on un-stubbed external hosts was considered and declined — stubbing stays
  per-spec, so a spec that opens an external surface and forgets a stub silently hits the
  real host.) The **open-data** specs register those stubs through `stubWhenLocal`
  (`helpers/lane.ts`), which is a **no-op on `e2e:remote`** — so remote falls through to
  the LIVE wrapper and the spec's assertions split on `E2E_LOCAL` (exact fixture figures
  local; "populates / ≥ N / distinct shading" remote). This is what exercises the real
  wrapper contract end-to-end through the UI (a stub can silently drift from the live
  shape — the `point → nearby` LoD2 rename left two stubs matching a dead path, green
  against themselves). Two open-data specs stay stubbed in BOTH lanes on purpose, because
  their subject is app LOGIC over controlled inputs, not "does the live source populate":
  `regional-context.spec.ts` (decoy-carrier exclusion, reverse-geocode-to-Kreis, codelist
  truncation fallback) and the outage block of `map-region-choropleth.spec.ts` (forces a
  `/geojson` 404 to prove silent degradation).
- **`headless:local`** — **the gap.** No browser → no `page.route`, and the base
  resolvers (`linkedWeatherBase`, `mastrNearby`, `lod2Rooftop`, `regionGeometry`,
  `regionalCube`) read `import.meta.env` only, which is `undefined` under Deno → they
  fall back to the real `wunderfacts.com` hosts. Planned fix: make the resolvers
  `Deno.env`-aware and point them at a shared local stub server — see
  [`../plans/plan-external-host-test-infra.md`](../plans/plan-external-host-test-infra.md)
  (slice 0) and [`../plans/plan-test-lane-naming.md`](../plans/plan-test-lane-naming.md).

The same `VITE_*_API_URI` indirection prod/dev use is the build-time switch: unset →
the live host (`remote`); a local fixture host → hermetic (`local`). It is CORS-enabled
and fetched directly (no dev proxy).

Current `e2e:local` coverage reflects the per-spec trade-off: `regional-context.spec.ts`
**stubs** via `page.route` (deterministic), while `cube-calendar-weather.spec.ts` runs
**live and tolerant** — it asserts the dereference+parse path resolves to a definite
state (a values table / chart, or an honest empty/no-overlap notice), not specific
temperatures, so a live-service hiccup can't flake it. Prefer a stub (or the env
override) when an assertion must pin exact figures.

## Local ports & parallel lanes

Every local-CSS Pod port (the `headless:local` / `e2e:local` lanes) derives from a
single offset (added to the base ports in
`test/config/localSeed.ts`: CSS `3456`, CSS control `3457`, preview app `4183`).
A task sets its **CSS base** with `LOCAL_PORT_OFFSET`; the rule is then dead simple:

> **CSS lane = base, JSS lane = base + 10.**

The `+10` is applied once, in `localSeed.ts` (a `LOCAL_POD_SERVER=jss` process bumps
its own offset), so every `:jss` task stays the trivial
`LOCAL_POD_SERVER=jss deno task <css-task>` with **no offset duplicated** — and a CSS
lane never collides with its JSS twin. The lanes:

- **`0` / `10`** — `dev:local` (CSS / JSS), the by-hand interactive stack; claims the
  memorable base ports (its Vite **dev** server is fixed at `5173`, not offset).
- **`20` / `30`** — `bench` (`bench:css`/`bench:ui:css` / `bench`/`bench:ui`) + `explore`.
- **`50`** — `handbuch` (CSS only).
- **`60`** — `videos` (CSS only).
- **`80` / `90`** — the everyday e2e lanes `it`, `e2e:local`, `e2e:local:reuse`,
  `e2e:stress`, and **both `e2e:local:matrix` lanes** (CSS `80` / JSS `90`). The matrix
  reuses this lane, so it is not run at the same instant as a single-lane `e2e:local`.

Each lane prints its resolved ports on start (`[tier-3 jss] pod=… app=… (offset 90)`).
To add a concurrent lane, give it an unused even base; its JSS twin is `+10` for free.

## Spec invariants (these caused silent hangs)

Coupling rules the specs and the app must respect — each one, when broken,
surfaces as a spec that hangs to its full timeout rather than a clear assertion:

- **Teardown extends the budget, never replaces it.** `test.setTimeout(x)` sets the
  *total* test budget from the test's start, not a fresh allowance. The end-of-spec
  cleanup helpers (`verifyAndReset` / `verifyAndResetBoth` in `helpers/cleanSlate.ts`)
  run from a sharing spec's test-body `finally`, so they **add** to the remaining
  budget (`test.setTimeout(test.info().timeout + T.afterAll)`). A bare
  `test.setTimeout(T.afterAll)` there would shrink a 150 s sharing test to 60 s
  mid-flow and abort it — usually after the body already passed — which reads as a
  generic "60000 ms timeout" and skips the wipe.
- **The Share dialog reads live building data.** `ManagePage` passes the building
  re-looked-up from the live buildings query, not the object captured at click time.
  A just-added energy year lands via a buildings refetch, and the per-year share
  picker is driven by `building.energyDatasets`; a frozen snapshot leaves the new
  year's checkbox unrendered, so the per-year `share-building` spec hangs on it.
- **A view's role must exist among the buildings.** `CreateViewDialog` only offers
  roles present in the buildings' `provenance`. `ensureView` creates an **Investor**
  view, so `share-aggregation` must seed an *investor* building — a `user`-seeded building
  leaves no "Investor" option in the Role dropdown and the spec hangs selecting it.
  More generally: a spec that drives the view/share dialogs must seed a building
  whose kind matches the role it then selects.
- **A dialog-presence *decision* needs a scoped locator, and recovery clicks need
  a timeout.** MUI keeps a closing dialog in the DOM through its fade-out, so a
  generic `getByRole("dialog").isVisible()` run right after another dialog was
  submitted can bind to that dialog's ghost — a poll that uses the check to decide
  "already open, skip the open click" then waits its whole budget on a dialog that
  no longer exists (`share-aggregation` did, against the just-closed `CreateViewDialog`).
  Scope such locators by the dialog's title text
  (`.filter({ hasText: ... })`), have helpers that submit a dialog not return
  until it is hidden (`ensureView` does), and give any click inside a
  poll's recovery path a `timeout` + `catch` — an unbounded click on a vanished
  element silently wedges every remaining poll iteration.

## Benchmarks (measure mode)

The benchmarks are not a new kind — they reuse the correctness substrate in **measure**
mode instead of assert: `bench` *is* `headless:local`, `bench:ui` *is* `e2e:local`. A
scalability suite beside the lanes — never gates. Sweeps a size axis, times the real
code paths, and draws gnuplot graphs (for the paper). Output → a per-run directory
`test-results/bench/<run-id>/` (gitignored), beside the e2e scopes
(`test-results/<scope>/<RUN_ID>`): `<name>.dat` + `<name>.gp` + `<name>.png` + an
`index.html` showing the run's setup (pod server, sweeps — recorded by each writer
into `setup.json`, see `runSetup.ts`) and all its figures. One scope for the figures (the per-backend
`bench-css/`/`bench-jss/` dirs hold the Playwright traces); each invocation (`bench`,
`bench:ui`) is its own run directory, named by the same second-resolution ISO 8601 UTC
timestamp the e2e RUN_ID uses (within a `bench:ui` run, the specs reuse Playwright's
`E2E_RUN_ID`, and the closing plot step targets the latest run dir). Set `BENCH_RUN_ID`
to label a run, or to point several invocations at one combined figure set — see
`test/bench/runId.ts`. `bench:plot` re-renders the latest run dir (or `BENCH_RUN_ID`).

```
deno task bench         # headless:local · measure — data layer (JSS; bench:css for CSS)
deno task bench:ui      # e2e:local · measure — browser cold-load renders (JSS; bench:ui:css for CSS)
deno task bench:plot    # re-render PNGs from existing .dat (after installing gnuplot)
```

- `bench` boots the local pod server (JSS by default — `bench:css` runs the same
  sweeps against CSS) + A/B actors and times: `buildings` (`fetchAndParseData` vs.
  # owned), `series` (list+parse vs. # daily files), `shared` (share via a data
  room + drain + fold vs. # shared from B), `rooms` (room lifecycle vs. # members),
  `room-churn` (fold vs. # role events at fixed membership).
- `bench:ui` builds + serves the prod app and times the browser end-to-end:
  time-to-render of the Manage building list (`manage-render`) and a data room's
  member list (`room-render`), the PAIR recipient-at-scale scenario
  (`share-render`: B shared N buildings with A — Share list, map markers, and
  the first-visit inbox drain), the post-login settle (`login-settle`: fresh
  login → map usable → network idle, on the pair substrate), the lazy series
  click (`series-render`: time-to-chart for a shared PT15M series vs. day-file
  count), and the TRIO benchmark roundtrip
  (`view-roundtrip`: B + C contribute N buildings each; A computes a benchmark
  view and shares it back; B sees it) — see `notes/plan-bench-pair-trio.md`.
  Every seeded building carries annual data 2020–2025 and seeded shares include
  energy. Seeding goes through the control server (`POST /seed`, `/seed-room`,
  `/seed-shared` — with `years=K` / `seriesDays=D` depth knobs —,
  `/seed-contrib`; Deno side), sweeps via `BENCH_SIZES` / `BENCH_ROOM_SIZES` /
  `BENCH_SHARED_SIZES` / `BENCH_SERIES_DAYS` / `BENCH_CONTRIB_SIZES`. Uses the
  default `granergize/` collection, builds with `VITE_OIDC_CLIENT_ID=` unset (so
  localhost login uses dynamic registration, not the prod client-ID doc), and
  `--retries=2` to ride out the JWKS warmup race.

The buildings sweep defaults to `100,…,1000` (sized for JSS's sub-ms requests —
expect minutes on CSS); the heavier-per-item dimensions default to `10,20,…,100`;
override with `BENCH_SIZES` / `BENCH_SERIES_DAYS` / `BENCH_SHARED_SIZES`, samples per
point with `BENCH_RUNS` (median, default 3). Graphs are PNG (pngcairo). gnuplot is
optional: `.dat` + `.gp` are always written; PNGs render only when `gnuplot` is on
PATH (else install it and run `deno task bench:plot`).

## Evals (judge mode)

The LLM evals score model output against a rubric — **judge** mode. They are
`headless`-shaped (Deno, no browser, real I/O) but `remote`-**only by nature**: an eval
calls the **real chat API** (that *is* the point), so a stubbed/cached LLM would defeat
it — there is no hermetic `:local` twin. (The chat API is the eval's external backend,
the third kind alongside the Pod and the data-wrappers.) They live in `test/eval/`,
outside the `deno test` unit glob and the Playwright lanes, and never gate.

```
LLM_API_KEY=… deno task eval:intent    # headless:remote · judge — NL → intent accuracy
LLM_API_KEY=… deno task eval:sweep      # headless:remote · judge — parameter sweep
```

`eval:intent` runs each `test/eval/cases.json` request through `translateToIntentJson`
and scores the resulting `{ name, params }`: **supported** verbs (in `INTENTS` today)
are scored pass/fail on the name (the headline accuracy); **frontier** verbs (not
dispatchable yet) are reported, not scored. The runner derives both populations from the
live catalog, so it tracks the code, not a hardcoded list. See
[`eval/README.md`](eval/README.md).

## Stress (load mode)

`deno task e2e:stress` / `:jss` — an `e2e:local`-substrate probe in **load** mode (the
JSS concurrent-login hammer, `login-stress.spec.ts`). Gated on `LOGIN_STRESS` so the
catalog runs never collect it; a skip that *does* surface is a real capability-gate
signal.
