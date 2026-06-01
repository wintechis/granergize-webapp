# End-to-end tests (Playwright)

Playwright drives Chromium against the app (the config starts the Vite dev server
itself). Three specs, by credential need:

- **`smoke.spec.ts`** — no login. Asserts the sign-in screen renders. CI-safe,
  runs with no credentials.
- **`screenshots.spec.ts`** — needs **one** throwaway Pod (account A). Captures the
  in-app guide screenshots into `public/guide/*.png`.
- **`sharing.spec.ts`** — needs **two** throwaway Pods (A and B). A hosts a data
  room, B joins it and takes the User role, A shares a building "by role"; B must
  see it under "Buildings shared with you". WebIDs are discovered via the room —
  none need configuring.

The two credentialed specs `test.skip` themselves when their env vars are absent,
so `deno task e2e` / CI never need credentials.

## Run

```
deno task e2e            # smoke only (no creds)
npm run screenshots      # guide screenshots  (needs account A)
npm run sharing          # cross-pod sharing  (needs accounts A + B)
# add --headed to watch / debug, e.g.  npm run sharing -- --headed
```

## Accounts (throwaway Pods only — never real accounts)

Create two disposable Pods (e.g. at <https://solidcommunity.net> → Sign up).
Provide their credentials via the environment — nothing is committed. Quickest way
is the committed template:

```
cp .env.e2e.example .env.e2e.local     # .env.e2e.local is gitignored
# edit .env.e2e.local — fill in the two passwords
source .env.e2e.local && npm run sharing
```

The variables (also settable as plain shell exports):

```
# Account A (used by screenshots + as the sharer)
export E2E_USERNAME_A=alice
export E2E_PASSWORD_A=…
export E2E_ISSUER_A=https://solidcommunity.net    # optional; this is the default

# Account B (the share recipient) — discovered via the room, no WebID needed
export E2E_USERNAME_B=bob
export E2E_PASSWORD_B=…
export E2E_ISSUER_B=https://solidcommunity.net    # optional
```

`screenshots.spec.ts` also accepts the legacy unsuffixed `E2E_USERNAME` /
`E2E_PASSWORD` / `E2E_ISSUER` (treated as account A) for backward compatibility.

## Notes

- The identity-provider **login and consent pages are provider-specific** and
  change over time. The selectors in `helpers/login.ts` are best-effort for
  solidcommunity.net (CSS server) and may need adjusting for another issuer or
  after a provider UI change. Run headed to see where it sticks.
- `sharing.spec.ts` discovers B's WebID through the data room (B joins A's room
  and takes the User role; A shares "by role"). It seeds a building on A only if A
  owns none, and B's receipt relies on the inbox copying the access grant into B's
  `dataSources.ttl` on load — so it allows a generous timeout for that round-trip.
- App tab labels are **View / Share / Meet**; the helpers/specs use those.
