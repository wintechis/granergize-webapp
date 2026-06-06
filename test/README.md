# Tests

Four tiers, fake → real one axis at a time, so each adjacent pair isolates one
failure class (data-layer → UI → provider interop):

- **Tier 1 — unit** (`deno task test`): hermetic logic + RDF, fake in-memory Pods
  (`src/**/*.test.ts`).
- **Tier 2 — headless** (`deno task it`): real data-layer fns over a throwaway local
  CSS, two actors A/B, no creds (`test/headless/`).
- **Tier 3 — browser e2e, local** (`deno task e2e:local`): full UI + OIDC against the
  same local CSS, credential-free, prod build (`E2E_LOCAL=1`, `E2E_PREVIEW=1`).
- **Tier 4 — browser e2e, remote** (`deno task e2e:remote`): the same specs against
  real Pods; `source` a `test/.env.e2e.*.local` creds file first.

Two roles, **A = Alice / B = Bob**: solo specs use A, sharing specs use A + B. The
specs live in `test/e2e/tasks/` (one per feature: login, organisation, add-building,
energy-entry, view-data, data-room, share-building, share-view); Tier 2 mirrors a
subset in `test/headless/tasks/`. Shared config in `test/config/` (`providers.ts`,
`accounts.ts`, `actors.ts`).

```
deno task test                                          # Tier 1
deno task it                                            # Tier 2 (no creds)
deno task e2e:local [test/e2e/tasks/<spec>.spec.ts]     # Tier 3 (no creds)
source test/.env.e2e.local && deno task e2e:remote      # Tier 4 (real Pods)
source test/.env.e2e.local && deno task e2e:remote:reset  # wipe A + B
```

Tier-4 writes to a throwaway collection (`VITE_POD_APP_DIR=granergize-e2e`), runs
serial (`workers: 1`), and aborts on a Cloudflare 1015 rate-limit. Tier 3 has a known
intermittent **local-CSS JWKS boot race** (a freshly-booted CSS transiently 401s a
DPoP token until its key set warms) — not an app bug; mitigated by a boot warmup and
bounded retries.

## Benchmarks (measure-and-report)

Scalability suite beside the tiers — never gates. Sweeps a size axis, times the real
code paths, and draws gnuplot graphs (for the paper). Output → `test/bench/results/`
(gitignored): `<name>.dat` + `<name>.gp` + `<name>.png`.

```
deno task bench       # Tier 2: data layer (buildings / series / shared)
deno task bench:ui    # Tier 3: browser cold-load of the Manage list
deno task bench:plot  # re-render PNGs from existing .dat (after installing gnuplot)
```

- `bench` boots the local CSS + A/B actors and times: `buildings`
  (`fetchAndParseData` vs. # owned), `series` (list+parse vs. # daily files),
  `shared` (`getSharedWithMe`+fold vs. # shared-in from B).
- `bench:ui` builds + serves the prod app and times time-to-render the Manage list;
  seeding goes through the control server's `POST /seed?n=` (Deno side). Uses the
  default `granergize/` collection, builds with `VITE_OIDC_CLIENT_ID=` unset (so
  localhost login uses dynamic registration, not the prod client-ID doc), and
  `--retries=2` to ride out the JWKS warmup race.

Sweeps default to `10,20,…,100` (the local CSS gets unstable under heavier seeding);
override with `BENCH_SIZES` / `BENCH_SERIES_DAYS` / `BENCH_SHARED_SIZES`, samples per
point with `BENCH_RUNS` (median, default 3). Graphs are PNG (pngcairo). gnuplot is
optional: `.dat` + `.gp` are always written; PNGs render only when `gnuplot` is on
PATH (else install it and run `deno task bench:plot`).
