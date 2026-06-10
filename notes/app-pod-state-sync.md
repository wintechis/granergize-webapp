# Keeping app state in sync with Pod state

The Pod is ground truth; the app only ever holds a **cached, derived projection**
of it — the React Query cache of parsed RDF (buildings, energy, shares, rooms,
views), joined and shaped in memory. Every freshness question reduces to one thing:
**when the Pod changes, does the projection that depends on it refetch?** This note
collects the mechanisms the app relies on for that, and the one structural place
the contract currently leaks. Companion to [`data-deref.md`](./data-deref.md) (what
gets dereferenced and joined) and [`data-layout.md`](./data-layout.md) (where it
lives on the Pod).

## The sync contract

There is no push from the Pod, so the projection is kept in step by four
deliberate mechanisms (centralised in `QueryProvider.tsx` and the query/mutation
hooks):

- **Server-driven freshness** — `staleTime: 0` plus conditional GET (`fetchFresh`,
  `cache: "no-cache"`, so 304s are cheap). The app never fabricates a freshness
  window; it asks the server each time and lets the validator decide.
- **Write-driven refetch** — the only thing that *changes* Pod state from the app
  is a mutation, and each mutation invalidates the query keys it affects
  (`mutations.ts` → `queryKeys`). A read that isn't invalidated by some write that
  changes its inputs will not refresh on its own.
- **Last-good-wins** — `placeholderData: keepPreviousData`, so an in-flight or
  failed refetch keeps the last good projection on screen rather than flashing
  empty.
- **Tolerating eventual consistency** — CSS container listings lag their members,
  so some reads reconcile rather than trust a single response (the delete path
  polls the `buildings/` listing until the deleted file is gone; a load 404-prunes
  an inaccessible shared source). The projection is corrected on read, not assumed.

The leak below is a case where the *first two* mechanisms don't compose: a read
whose cache key doesn't cover all the Pod inputs it folds, so no write that changes
those inputs is seen to change the key, and the server-driven refetch never fires.

## The leak — a derived read whose key under-covers its inputs

A React Query cache key must capture every Pod input whose change alters the
query's result. The risky shape here is two-phase: a phase-1 query lists/parses a
set of container items (each carrying links to further resources), and a phase-2
query folds those linked resources into a derived result, keyed off the phase-1
set. If phase 2's key encodes only the *identity of the set* (which items exist)
and not the *content it folds* (which linked resources each item points at), then a
Pod change that edits an item's links **without** adding or removing an item is
invisible: the key is unchanged, so the projection neither refetches nor is
considered stale. `staleTime: 0` and `keepPreviousData` then make the staleness
*silent* — the eager refetch keeps returning the same key's cached fold, and the
last-good projection stays on screen.

## The instance, and its fix — energy

`useBuildings` (phase 1) parses each building, including its
`cons:hasEnergyDataset` links; `useEnergy` (phase 2) folds those linked datasets
into the per-building energy the map and charts read. Its key was the **sorted set
of building ids**, so writing an energy year to an *existing* building — which
adds/replaces a link but not an id — did not refetch; the map energy lens, which
wants every building's current energy at once right after a write, read stale.

Fixed by folding the linked content into the key: `useEnergy` now keys on
`energyKeyFor(buildings)` (pure, exported, unit-tested) — each building's id **plus
its sorted dataset slugs** (year/granularity/scenario) — so adding or deleting an
energy year changes the key and refetches. It still also refetches when the
building set changes, and `queryKeys.energy` still prefix-matches so existing
invalidations work.

This is masked in the ordinary single-building flow (the energy-year mutation
invalidates both keys, and the user lands on that one building's own energy view,
which fetches fresh); only the *bulk* read exposed it.

## Audit of the other reads

The question to ask of any read: **"can a resource this query folds change on the
Pod without my key changing AND without a mutation invalidating it?"** If yes, the
projection can drift out of sync. Applying it to the query hooks (`queries.ts`):

- **`useEnergy`** was the one query whose key was *derived from another query's
  output* (the building set) yet under-covered the content it folds (ids, not
  dataset links). Fixed (above). It is the only derived-key read that under-covered.
- **`useRoomLog`** is also derived-keyed (`["roomLog", webId, current-room-IRI]`),
  but the room IRI is the right *identity* and the log's event content changes are
  covered by direct invalidation — every room mutation invalidates `queryKeys.roomLog`
  (`mutations.ts`). Keyed correctly, content via invalidation. Not the trap.
- The top-level reads — `sharedWithMe`, `sharedBuildings`, `viewDefinitions`,
  `sharedViews`, `receivedViews`, `contacts` — use a constant `["name", webId]` key.
  They don't derive a key from upstream data, so the key can't under-cover; freshness
  is `staleTime: 0` refetch-on-observe plus mutation invalidation. Sound, different
  model.
- **`useRooms`** is deliberately `staleTime: Infinity` and patched optimistically by
  the room mutations (a background refetch could revert an in-flight room switch).
  Intentionally outside the auto-refetch model.

The audit also surfaced one **distinct gap** of the same *family* but a different
mechanism, now fixed: **`useReceivedBenchmarks`** folds `getReceivedViews` (it loads
each received snapshot and keeps the benchmark ones), with a constant key. The inbox
drain (`useCheckInbox`) invalidated `sharedWithMe`, `receivedViews` and `buildings`
but **not** `receivedBenchmarks`, so a benchmark snapshot newly archived into
`shared-in/` could be missing from the energy view's Benchmark column until that
query was otherwise remounted. This was an *invalidation-coverage* gap (constant key,
a missing `invalidateQueries`), not a *key-coverage* one — `useCheckInbox`'s
`onSettled` now invalidates `queryKeys.receivedBenchmarks` alongside `receivedViews`
(covered by a `queries.test.ts` case).

## The principle

Prefer making the refetch fall out of the data over making it fall out of
discipline. Keying a derived read on the inputs it actually folds keeps it in sync
by construction; relying on every mutation that touches a linked resource to
remember to invalidate the dependent key is the fragile alternative — it works
until one call site forgets.
