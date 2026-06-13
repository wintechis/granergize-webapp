# Tests

Four tiers, fake → real one axis at a time, so each adjacent pair isolates one
failure class (data-layer → UI → provider interop):

- **Tier 1 — unit** (`deno task test`): hermetic logic + RDF, fake in-memory Pods
  (`src/**/*.test.ts`).
- **Tier 2 — headless** (`deno task it`): real data-layer fns over a throwaway local
  CSS, two actors A/B, no creds (`test/headless/`).
- **Tier 3 — browser e2e, local** (`deno task e2e:local`): full UI + OIDC against the
  same local CSS, credential-free, prod build (`E2E_LOCAL=1`).
- **Tier 4 — browser e2e, remote** (`deno task e2e:remote`): the same specs against
  real Pods; `source` a `test/.env.e2e.*.local` creds file first.

Three roles, **A = Alice / B = Bob / C = Charlie**, and the catalog specs split by
pod count: **solo** specs use A; **duo** (cross-Pod sharing) use A + B; **trio** (the
benchmark-service round-trip) use A + B + C. The
specs live in `test/e2e/tasks/` (one per feature: login, organisation, add-building,
energy-entry, view-data, data-room, share-building, share-view); Tier 2 mirrors a
subset in `test/headless/tasks/`. Shared config in `test/config/` (`providers.ts`,
`accounts.ts`, `actors.ts`).

```
deno task test                                          # Tier 1
deno task it                                            # Tier 2 (no creds)
deno task e2e:local [test/e2e/tasks/<spec>.spec.ts]     # Tier 3 (no creds)
source test/.env.e2e.local && deno task e2e:remote      # Tier 4 (real Pods)
```

Tier-4 writes to a throwaway, **per-run** collection (`granergize-e2e-<uuid>`,
generated in `playwright.config.ts`) so leftover/stuck resources from an earlier run
can't impede a fresh one — there is no reset step. It runs serial (`workers: 1`) and
aborts on a Cloudflare 1015 rate-limit. Tier 3 has a known
intermittent **local-CSS JWKS boot race** (a freshly-booted CSS transiently 401s a
DPoP token until its key set warms) — not an app bug; mitigated by a boot warmup and
bounded retries.

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
  view, so `share-view` must seed an *investor* building — a `user`-seeded building
  leaves no "Investor" option in the Role dropdown and the spec hangs selecting it.
  More generally: a spec that drives the view/share dialogs must seed a building
  whose kind matches the role it then selects.
- **A dialog-presence *decision* needs a scoped locator, and recovery clicks need
  a timeout.** MUI keeps a closing dialog in the DOM through its fade-out, so a
  generic `getByRole("dialog").isVisible()` run right after another dialog was
  submitted can bind to that dialog's ghost — a poll that uses the check to decide
  "already open, skip the open click" then waits its whole budget on a dialog that
  no longer exists (`share-view` did, against the just-closed `CreateViewDialog`).
  Scope such locators by the dialog's title text
  (`.filter({ hasText: ... })`), have helpers that submit a dialog not return
  until it is hidden (`ensureView` does), and give any click inside a
  poll's recovery path a `timeout` + `catch` — an unbounded click on a vanished
  element silently wedges every remaining poll iteration.

## Benchmarks (measure-and-report)

Scalability suite beside the tiers — never gates. Sweeps a size axis, times the real
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
deno task bench         # Tier 2: data layer (JSS; bench:css for the CSS sweep)
deno task bench:ui      # Tier 3: browser cold-load renders (JSS; bench:ui:css for CSS)
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
