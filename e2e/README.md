# End-to-end tests (Playwright)

Playwright drives Chromium against the app (the config starts the Vite dev server
itself). Eight specs, by credential need:

- **`smoke.spec.ts`** — no login. Asserts the sign-in screen renders. CI-safe,
  runs with no credentials.
- **`storage-smoke.spec.ts`** — needs **one** throwaway Pod (defaults to account
  **B** on solidweb.org, the more reliable Pod; override with `E2E_SMOKE_ACCOUNT=A`).
  A shallow, broad smoke of the container-native storage redesign: own buildings
  are listed on Manage (the `buildings/` listing + demo seed), the aggregated-views
  section folds `views/`, the Share tab folds `shared-in/`, and hosting+deleting a
  room exercises `prefs.ttl` / `bookmarks.ttl` / `rooms/`. Cleans up the room it
  creates. Expects a used or freshly-wiped Pod (so the demo buildings are present).
- **`energy-smoke.spec.ts`** — needs **one** throwaway Pod (defaults to account
  **B**; `E2E_SMOKE_ACCOUNT=A` to switch). Finds a seeded building on Manage and
  opens its `/energy/:id` deep link, asserting the energy detail (annual
  table + bar chart, or the 15-min series chart) renders — i.e. `loadEnergy` + the
  charts run on the unified `gran:EnergyDataset` model. Expects a Pod **seeded by
  the current code** (wipe + reload first, so the buildings carry
  `gran:hasEnergyDataset`).
- **`energy-entry.spec.ts`** — needs **one** throwaway Pod (defaults to account
  **B**). Drives the per-year energy form from the Manage row action: writes a fixed
  far-future year (2099) **actual + planned (Soll)** dataset (idempotent — re-runs
  overwrite the same resources) and confirms the actual flows back into the energy
  view. Covers PROBLEMS.md #5 / #15 / #16.
- **`building-delete.spec.ts`** — needs **one** throwaway Pod (defaults to account
  **B**). Clicks the Manage "Delete building" row action and asserts the building's
  row disappears and the owned-building count drops by one (PROBLEMS.md #3).
  **Destructive** — consumes one seeded building, so wipe + reseed before re-running.
- **`excel-export.spec.ts`** — needs **one** throwaway Pod (defaults to account **B**).
  Asserts the browser download fires with the right filenames and that an exported
  workbook re-imports to the same buildings (full round-trip via Add Building's file
  picker, PROBLEMS.md #8). Destructive (re-imports then deletes the copies);
  self-cleaning, expects a reseeded Pod.
- **`view-sharing.spec.ts`** — needs **two** throwaway Pods (A and B). A hosts a data
  room, B joins it + takes the User role, A creates an aggregated view and shares it
  with B via the dialog's room-members list; B must see it under "Views shared with
  you" and the values render (PROBLEMS.md #17). Same 4-part split as `sharing.spec.ts`
  (`-g "view part 1".."view part 4"` with cooldowns); WebIDs discovered via the room.
- **`screenshots.spec.ts`** — needs **account C** (the slow solidcommunity.net Pod),
  so the guide shows canonical solidcommunity.net WebIDs/URIs. Captures the in-app
  guide screenshots into `public/guide/*.png`.
- **`data-rooms.spec.ts`** — needs **one** throwaway Pod (account A). Drives the
  Connect-tab room lifecycle: host a room then enter/leave it back and forth, and
  host → leave → re-enter → delete. Each test hosts its own room and deletes it at
  the end (cleans up after itself). Runs serially behind one login; uses the
  success notifications as the action signal with a generous settle window (the
  per-action Pod write + room-log re-read is slow under throttling).
- **`sharing.spec.ts`** — needs **two** throwaway Pods (A and B). A hosts a data
  room, B joins it and takes the User role, A shares a building "by role"; B must
  see it under "Buildings shared with you". WebIDs are discovered via the room —
  none need configuring.
- **`request-audit.spec.ts`** — needs **one** Pod (account A). Diagnostic, not an
  assertion test: it captures every network request from login through a
  click-through of all tabs and prints which resources are fetched more than once
  (with per-hit timing, so a StrictMode/double-mount burst reads differently from
  per-tab-switch refetches). Use it to spot request storms / duplicated fetches.
- **`data-room-switch-debug.spec.ts`** — needs **one** Pod (default account **B**;
  override with `E2E_DEBUG_ACCOUNT=A`). Diagnostic, not an assertion test: hosts two
  rooms, switches the active room back and forth, and streams the room-registry
  exchange (`prefs.ttl` active-room pointer + `bookmarks.ttl`) — method/status/ETag
  + conditional headers — to classify a switch that reverts (client refetch vs
  stale conditional read vs throttling).

The seven credentialed specs `test.skip` themselves when their env vars are absent,
so `deno task e2e` / CI never need credentials.

There is also a **headless data-layer integration test** that is *not* Playwright:
`scripts/data-layer-live.ts` runs the real app data-layer functions (serialize →
upload → register → read back via `fetchAndParseData` → hide/unhide → hard
`deleteBuilding`) over a DPoP client-credentials session against account **A**'s
Pod, then restores it (snapshot / restore of the registry + hidden file, deletes
its test building). It's the live counterpart to the offline
`buildingSerializer.test.ts`. It does **not** exercise `removeAppData` (the full
granergize/ wipe) — that's offline-tested only, to avoid clobbering A's shared
demo/room data. Auth is hand-rolled in
`scripts/liveSession.ts` (the Inrupt node client's key isn't extractable under
Deno).

## Run

```
deno task e2e            # smoke only (no creds)
npm run screenshots      # guide screenshots  (account C, solidcommunity.net)
npm run sharing          # cross-pod sharing  (accounts A + B)
# add --headed to watch / debug, e.g.  npm run sharing -- --headed

# Single-account specs run on a fast Pod (A or B — interchangeable):
source .env.e2e.local && deno task e2e storage-smoke   # storage-redesign smoke
source .env.e2e.local && deno task e2e energy-smoke    # energy-model smoke (wipe+reseed first)
source .env.e2e.local && deno task e2e energy-entry    # per-year entry + Soll-Ist
source .env.e2e.local && deno task e2e building-delete # delete a building (destructive; reseed first)
source .env.e2e.local && deno task e2e excel-export    # export round-trip (destructive; reseed first)
source .env.e2e.local && deno task e2e data-rooms      # room lifecycle
source .env.e2e.local && deno task e2e request-audit   # request audit

# Whole credentialed suite — force serial so logins don't fire in parallel:
source .env.e2e.local && deno task e2e --workers=1

source .env.e2e.local && deno task it:live   # live data-layer test (needs account A)
```

> **Heads-up on rate limiting.** solidcommunity.net sits behind Cloudflare, which
> throttles bursts of logins/requests with HTTP 429. The config doesn't pin a
> worker count, so Playwright parallelizes across spec *files* — several Solid
> logins then fire **at once**, which reliably trips the limiter. **Run the
> credentialed suite with `--workers=1`** so logins happen one at a time. Even
> then, running several credentialed specs back-to-back (especially `sharing`,
> which logs in **two** accounts in a row) can make a later spec fail at the
> *identity-provider login form* — the form never renders because the IdP page
> itself got throttled. This is environmental, not a code regression: re-run a
> single spec after a short pause, or space the runs out.

## Accounts (throwaway Pods only — never real accounts)

Three disposable Pods. **A and B are fast Pods and interchangeable** for most
specs (single-account specs run on either; `sharing` uses both). **C is the slow
solidcommunity.net Pod**, used only by `screenshots` (so the guide shows canonical
solidcommunity.net URIs). Provide credentials via the environment — nothing is
committed; quickest way is the committed template:

```
cp .env.e2e.example .env.e2e.local     # .env.e2e.local is gitignored
# edit .env.e2e.local — fill in the passwords
source .env.e2e.local && npm run sharing
```

The variables (also settable as plain shell exports):

```
# Account A — fast Pod
export E2E_USERNAME_A=alice
export E2E_PASSWORD_A=…
export E2E_ISSUER_A=https://…                      # the fast Pod's issuer

# Account B — fast Pod (the sharing recipient; WebID discovered via the room)
export E2E_USERNAME_B=bob
export E2E_PASSWORD_B=…
export E2E_ISSUER_B=https://…

# Account C — slow solidcommunity.net Pod, used by `screenshots`
export E2E_USERNAME_C=carol
export E2E_PASSWORD_C=…
export E2E_ISSUER_C=https://solidcommunity.net     # optional; this is the default
```

## Notes

- The identity-provider **login and consent pages are provider-specific** and
  change over time. The selectors in `helpers/login.ts` are best-effort for
  solidcommunity.net (CSS server) and may need adjusting for another issuer or
  after a provider UI change. Run headed to see where it sticks.
- `sharing.spec.ts` discovers B's WebID through the data room (B joins A's room
  and takes the User role; A shares "by role"). It seeds a building on A only if A
  owns none, and B's receipt relies on `readInbox` archiving the access grant into
  B's `shared-in/` log on load — so it allows a generous timeout for that round-trip.
- App tab labels are **Explore / Manage / Share / Connect**; the helpers/specs use
  those. Buildings are added/shared/exported and aggregated views are managed on the
  **Manage** tab; "Buildings shared with you" lives on **Share**; data rooms on
  **Connect**.
