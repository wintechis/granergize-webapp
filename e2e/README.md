# End-to-end tests (Playwright)

Playwright drives Chromium against the app (the config starts the Vite dev server
itself). Specs skip themselves when their credentials are absent, so
`deno task e2e` / CI never need any.

## Specs

- **No login:** `smoke` (sign-in screen renders; login links the Praxishandbuch).
- **One fast Pod (A or B):** `storage-smoke`, `energy-smoke`, `energy-entry`,
  `building-delete`, `excel-export`, `excel-upload`, `provenance`, `data-rooms`.
  Self-cleaning where they mutate.
- **Two Pods (A + B):** `sharing` (share a building by role), `view-sharing`
  (share an aggregated view, then revoke). WebIDs are discovered via the data room.
- **Diagnostics (one Pod, not assertions):** `request-audit` (duplicate-fetch
  audit), `data-room-switch-debug` (room-switch network trace).
- **Screenshots (account C):** `screenshots` captures the Praxishandbuch figures
  into `docs/figures/*.png` (uses solidcommunity.net so the URLs shown are
  canonical).

## Run

```
deno task e2e                                          # smoke only (no creds)
source .env.e2e.local && deno task e2e <name>         # a single spec
source .env.e2e.local && deno task e2e --workers=1    # whole credentialed suite (serial)
source .env.e2e.local && npm run screenshots          # handbuch figures (account C)
source .env.e2e.local && deno task it:live            # live data-layer test (account A, not Playwright)
# add --headed to watch / debug
```

**Run the credentialed suite with `--workers=1`.** solidcommunity.net sits behind
Cloudflare and throttles parallel logins (HTTP 429), which can make a later spec
fail at the identity-provider login form. That's environmental — re-run the spec
after a short pause, or space the runs out.

## Accounts (throwaway Pods only — never real accounts)

**A and B** are fast Pods and interchangeable (single-account specs run on either;
two-Pod specs use both). **C** is the slow solidcommunity.net Pod, used only by
`screenshots`. Provide credentials via the environment (nothing is committed):

```
cp .env.e2e.example .env.e2e.local     # gitignored; fill in the passwords
```

Override the default account for a single-account spec with `E2E_SMOKE_ACCOUNT` /
`E2E_DEBUG_ACCOUNT`. The IdP login/consent selectors in `helpers/login.ts` are
best-effort for solidcommunity.net and may need adjusting for another issuer.
