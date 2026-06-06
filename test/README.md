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
  **local CSS**, credential-free; run `deno task e2e` (the default e2e run). The
  hermetic, CI-able UI tier — no Pods, no secrets.
- **Tier 4 — e2e (remote):** the SAME UI specs against **real Pods**; run
  `deno task e2e:base` (creds in `test/.env.e2e.local`).

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
- **Tier 4** (`test/e2e/`) is Playwright against real Pods. `tasks/` = one spec per
  catalog slug; `support/` = infra (screenshots). Credentialed specs self-skip
  without creds; cross-Pod specs skip unless an **interoperating** provider pair is
  configured.

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
WebID layout), `accounts.ts` (slots A/B/C/pool from env; in Tier 3 they resolve to
the seeded local-CSS pods instead), `resolve.ts` (a spec declares what it needs →
accounts or a skip reason), `actors.ts` (the A/B model).

Credentials (Tier 4 only): `cp test/.env.e2e.example test/.env.e2e.local` and fill
in passwords (gitignored). Per slot: `E2E_{USERNAME,PASSWORD}_X` + `E2E_PROVIDER_X`
(a providers id) or `E2E_ISSUER_X`; `E2E_WEBID_X` overrides a derived WebID.

Tier-4 specs split into account GROUPS, bound by convention so you pick a *group*,
never map specs one by one (`.env.e2e.example` documents the four slots):

- **A, B** — two Pods on ONE provider (e.g. solidcommunity.net) → the **sharing**
  specs (`share-building`, `share-view`) + `screenshots` (slot A). Two distinct
  Pods on the same server interoperate, so cross-Pod sharing RUNS (it skipped
  before only because no interoperating pair was configured).
- **C, D** — two **solo** Pods on different providers (e.g. solidweb + redpencil).
  The single-account specs run against ONE, chosen by `E2E_SOLO` (slot id; default
  `C`). Different hosts → the two solo runs go in parallel.

```
deno task test                                   # Tier 1
deno task it                                      # Tier 2 (no creds)
deno task e2e                                     # Tier 3: full UI, local CSS, no creds
deno task e2e:base                              # Tier 4 smoke (no creds; login spec)

# Tier 4 against real Pods — these source test/.env.e2e.local for you:
deno task e2e:solo                                # solo specs on both solo Pods (C + D, parallel)
deno task e2e:sharing                             # sharing specs on the A+B pair
deno task e2e:all                                 # solo C+D (parallel) + sharing, one cmd
```

`deno task e2e:{all,solo,sharing}` (→ `test/run-e2e.sh`) source `test/.env.e2e.local`,
start one shared dev server, and run each group as its own process (different hosts →
parallel without contention); logs stream to `/tmp/e2e-{solidweb,redpencil,sharing}.log`.
For a single project/spec by hand, source the env file and use the raw base, e.g.
`source test/.env.e2e.local && deno task e2e:base --project=support`.

Concurrency: a single Playwright run is serial by default (`workers` fans out only
when a distinct-unthrottled-host **pool** `P0..Pn` is configured). Cross-provider
parallelism comes instead from running separate processes per host (the `:all`
script) — the safe way to parallelize without stampeding one provider.
