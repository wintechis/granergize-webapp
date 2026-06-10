# Plan: fold each sharing log once per load

The `shared-in/` and `shared-out/` event logs are folded (container listing +
one GET per event resource) by several independent readers on every app load:
`shared-in/` four times — `loadBuildings` (discovering shared building
sources), `getSharedWithMe`, `getReceivedViews`, and `getReceivedBenchmarks`
(which calls `getReceivedViews` again) — and `shared-out/` twice
(`getSharedBuildings`, `getSharedViews`). With N events that is ~4×(N+1)
round-trips where 1×(N+1) suffices, and N grows monotonically with every
share/revoke. The fix: one query per log container holding the folded
`ActiveGrant[]`; everything else derives from it in memory.

## Design

### Two log queries, pure derivations

- New hooks `useSharedInGrants()` / `useSharedOutGrants()` (keys
  `queryKeys.sharedInLog` / `sharedOutLog`, WebID-namespaced) run
  `foldSharingLog` once each. They are the ONLY hook-layer readers of the logs.
- The four list shapes become pure functions in `sharingManager.ts`, taking
  the folded grants instead of a session:
  `sharedWithMeFromGrants(grants, hiddenBuildings)`,
  `sharedBuildingsFromGrants(grants)`, `receivedViewsFromGrants(grants)`,
  `sharedViewsFromGrants(grants)`. The session-taking wrappers stay for
  non-hook callers (headless Tier-2 tasks, `revokeAllBuildingRecipients`,
  `viewComputer.sharedContributorBuildings`) as fold+derive one-liners, with a
  JSDoc note that hook code must use the log queries instead.
- `useSharedWithMe` / `useReceivedViews` / `useSharedBuildings` /
  `useSharedViews` compose the log query with the derivation and return the
  `{ data, isLoading, isFetching, error }` shape their consumers already use
  (the `useRoomState` composition precedent). `useSharedWithMe` additionally
  needs the hidden-buildings set, so prefs gets its own small query
  (`usePrefs`, key `queryKeys.prefs`) instead of being fetched inside the
  derivation.
- `useReceivedBenchmarks` stays a real query (it fetches each received
  snapshot) but becomes *dependent*: enabled once the shared-in grants are
  loaded, keyed on the sorted received-snapshot URLs (content fingerprint, the
  `energyKeyFor` pattern), and calling
  `getReceivedBenchmarksFor(session, receivedViews)` — no second fold.

### Buildings join the same graph

`loadBuildings` no longer folds the log itself: it takes the shared building
sources as a parameter, and `useBuildings` becomes dependent on
`useSharedInGrants` (enabled once loaded; key carries the sorted shared-source
fingerprint, so a grant arriving/leaving refetches buildings because the data
changed). `fetchAndParseData` — the non-React orchestration the headless tier
drives — keeps its self-contained signature by folding once itself and passing
the sources through.

The reconciliation prune keeps working: `loadBuildings` still appends a
self-revocation for an inaccessible source, and now reports the pruned sources
in its result so the buildings query can invalidate the shared-in log query —
the next fold drops the pruned grant and the dependent readers follow.

### Invalidation map

Mutations stop invalidating the derived keys and invalidate the log they
actually changed: share/revoke building → `sharedOutLog`; inbox drain →
`sharedInLog` (+ `receivedBenchmarks`, whose snapshot *contents* can change
without the grant set changing); share/revoke view → `sharedOutLog`; toggle
visibility → `prefs` (it writes prefs.ttl, not a log). `buildings`
invalidations stay where they are — the buildings query also refetches by key
when the grant set changes.

## Cost after

One fold of each log per load (plus one conditional-GET revalidation per
invalidation), independent of how many list views render. Not addressed here
(possible follow-up): per-event immutable-resource caching inside the fold
(events never change once POSTed, so only the container listing needs
revalidation), and the second prefs read inside `loadBuildings`.

## Testing

- Hook tests (offline fixture, `renderHook`): mounting
  buildings + sharedWithMe + receivedViews + receivedBenchmarks together
  fetches the `shared-in/` container listing ONCE (assert via the fake
  session's recorded calls) — the actual point of the change; derivation
  correctness per pure function; toggle-visibility invalidates prefs and the
  list updates.
- Existing service tests migrate to the pure derivations; the wrapper
  functions keep their current tests.
- Tier-2 headless tasks (`share-building`, `share-view`, `benchmark`,
  `attachment-share`, `delete-shared-building`) keep using the session
  wrappers — unchanged semantics, still proving fold+derive against a real
  server.
