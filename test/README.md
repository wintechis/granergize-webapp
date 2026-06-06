# Tests

A tiered, provider- and concurrency-aware test foundation. Four tiers climb from
fake to real one axis at a time — **unit → CI (headless) → browser e2e (local) →
e2e (remote)** — so each adjacent pair is a *bisection* that isolates one failure
class:

- Tier 1 → 2: fake Pods → a real server (isolates data-layer bugs);
- Tier 2 → 3: data-layer → real browser UI, same local server (isolates UI/render bugs);
- Tier 3 → 4: local CSS → real heterogeneous Pods, same UI (isolates provider/server-interop bugs).

## Tiers

- **Tier 1 — unit:** hermetic logic + RDF; run `deno task test`; substrate: fake
  in-memory Pods (`src/**/*.test.ts`).
- **Tier 2 — CI / headless:** real data-layer fns, no browser; run `deno task it`;
  substrate: a throwaway **local CSS** (no creds).
- **Tier 3 — browser e2e (local):** the full UI + OIDC, but against a throwaway
  **local CSS**, credential-free; run `deno task e2e:local`. The hermetic, CI-able
  UI tier — no Pods, no secrets.
- **Tier 4 — e2e (remote):** the SAME UI specs against **real Pods**; run
  `deno task e2e:remote` (creds: `source` a `test/.env.e2e.*.local` file first).

More detail per tier:

- **Tier 1** lives next to the code (`src/**/*.test.ts`) and never touches a network/server.
- **Tier 2** (`test/headless/`) boots one local Community Solid Server with two
  seeded accounts (A, B), then runs each per-slug module in `tasks/` over the A/B
  **actor** model. No credentials; ~15 s; self-cleaning.
- **Tier 3** reuses the Tier-4 specs via a Playwright `local` project
  (`E2E_LOCAL=1`): `test/e2e-local/css.ts` boots the same CSS as Tier 2, and
  `accounts.ts` maps slots to its two seeded pods (so the unchanged specs need no
  creds; the two pods interoperate, so the sharing specs run too). It runs against
  the **production build** (`E2E_PREVIEW=1`) — a Vite *dev*-server quirk aborts
  authenticated writes in-browser, which `vite preview` (and prod) don't.
- **Tier 4** (`test/e2e/`) is Playwright against real Pods, using **two roles,
  A = Alice and B = Bob** — solo specs run against Alice, sharing specs against
  Alice + Bob. `tasks/` = one spec per catalog slug; `support/` = infra
  (screenshots, Alice); `maintenance/` = reset (both roles). Credentialed specs
  self-skip without creds; cross-Pod specs skip unless A + B form an
  **interoperating** pair. Writes go to a throwaway collection
  (`VITE_POD_APP_DIR=granergize-e2e`), never real `granergize/` data — see below.

### Tier 3 — known substrate flakiness (the JWKS race)

A handful of Tier-3 specs fail **intermittently** (they shuffle run to run, e.g.
`add-building` / `energy-entry` / `excel-export`). The cause is **the local CSS, not
the app or the writes**: just after CSS boots, its OIDC resource server transiently
401s a DPoP-bound access token with *"no applicable key found in the JSON Web Key
Set"* until its JWKS is warm. That 401 cascades — a profile read returns "no role",
the write itself 401s, so the success notice never appears and the spec times out.
The data layer is fine (when the token verifies, CSS returns `201` and the write
lands); the flakiness is purely auth/OIDC timing, and it **never happens on real
Pods** (Tier 4 passes these specs).

Mitigations in place: `startLocalCss` warms token verification on boot (a
client-credentials round-trip, retried until it 200s) — this cut the failures
roughly in half. It isn't a full fix (the browser uses an auth-code token, a
slightly different path), so a few intermittent failures remain. If you need Tier 3
reliably green, the honest options are a stronger warmup (a throwaway browser login
per boot, or a pre-provisioned stable CSS JWKS) or a bounded Playwright retry on the
`local` project — it's masking a substrate race, not an app bug.

### Tier 4 — isolation, reset, rate-limit guard

- **Isolation.** All paths build from one source — `APP_DIR`/`appRoot()`
  (`solidUtils.ts`, `VITE_POD_APP_DIR`, default `granergize`); real-Pod runs set
  `granergize-e2e`, so tests never touch real `granergize/` data.
- **Reset.** `deno task e2e:remote:reset` wipes that collection for both roles
  (Alice + Bob) via the app's own "Remove all app data" — a `reset` project gated on
  `E2E_RESET` (so a normal run can't wipe). Run it after a leaky run.
- **Cloudflare 1015.** On a rate-limit, the run aborts at once instead of grinding
  every spec to timeout: a response watcher (`e2e/helpers/cloudflareGuard.ts`) flags
  the 1015, a reporter (`e2e/cf1015Reporter.ts`) exits. The 1015 page lacks CORS, so
  only Playwright sees it — the app's fetch just throws `TypeError` (`retryFetch.ts`).

## The task catalog (the shared spine)

One bullet per slug — Tier 2 (`test/headless/tasks/`) / browser e2e
(`test/e2e/tasks/`, run by Tiers 3 local and 4 remote):

- `login` — Tier 2: —; e2e: login screen
- `organisation` — Tier 2: —; e2e: role → provenance (+ logo, #11 pending)
- `add-building` — Tier 2: building CRUD; e2e: add/delete, excel import/export
- `energy-entry` — Tier 2: —; e2e: Soll-Ist entry
- `view-data` — Tier 2: —; e2e: energy chart + Manage/Share render
- `data-room` — Tier 2: membership + room switch; e2e: host/enter/leave/delete
- `share-building` — Tier 2: share-by-role + ACL read; e2e: cross-Pod, the A+B pair
- `share-view` — Tier 2: share + revoke + ACL; e2e: cross-Pod, the A+B pair

## Config & providers

`test/config/` is the single, runtime-agnostic source of truth (read by both Deno
and Playwright): `providers.ts` (NSS / CSS-v5 / CSS-v6 / local — auth, throttling,
WebID layout), `accounts.ts` (slots A/B from env; in Tier 3 they resolve to the
seeded local-CSS pods instead), `resolve.ts` (a spec declares what it needs →
accounts or a skip reason), `actors.ts` (the A/B model).

There are **two roles, A = Alice and B = Bob**, and you configure the Pod/WebID each
role uses *per run* (`.env.e2e.example` documents them). Per role X (A or B):
`E2E_{USERNAME,PASSWORD}_X` + `E2E_PROVIDER_X` (a providers id) or `E2E_ISSUER_X`;
`E2E_WEBID_X` overrides a derived WebID. The specs never map to a provider
themselves:

- **solo** specs (login, organisation, add-building, energy-entry, view-data,
  data-room, excel-import/export, building-details) → **Alice (A)**.
- **sharing** specs (`share-building`, `share-view`) → **Alice + Bob (A + B)**;
  `screenshots` → Alice. Cross-Pod sharing RUNS when A + B interoperate (same
  provider, or `E2E_INTEROP_OK=1`).

Credentials come from the shell — keep a `.local` file per provider scenario
(gitignored via `.env.*.local`) and `source` the one you want before running:

```
deno task test                                   # Tier 1
deno task it                                      # Tier 2 (no creds)
deno task e2e:local                               # Tier 3: full UI, local CSS, no creds
deno task e2e:local test/e2e/tasks/<spec>.spec.ts # Tier 3: one spec by path

# Tier 4 against real Pods — source the env file (= provider scenario) you want:
source test/.env.e2e.local && deno task e2e:remote                 # solo + sharing
source test/.env.e2e.solidweb.local && deno task e2e:remote        # solo on solidweb (NSS)
source test/.env.e2e.local && deno task e2e:remote:reset           # wipe A + B
source test/.env.e2e.local && deno task e2e:remote:spec test/e2e/tasks/<spec>.spec.ts   # one spec
source test/.env.e2e.local && deno task e2e:remote:spec --project=support                # screenshots
```

Provider selection IS which file you source (env-file lines use `export`, so a plain
`source` reaches the test process). Naming convention `test/.env.e2e.<scenario>.local`
keeps each scenario file ignored by `.gitignore`'s `.env.*.local`.

Concurrency: the whole Tier-4 run is **serial** (`workers: 1`) — fanning specs across
workers would log into the same Pod host concurrently and trip Cloudflare throttling.
To cover a second provider, reconfigure a role (source a different env file) and run
again.
