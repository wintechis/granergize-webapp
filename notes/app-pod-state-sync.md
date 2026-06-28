# Keeping app state in sync with Pod state

The Pod is ground truth; the app only ever holds a **cached, derived projection**
of it — the React Query cache of parsed RDF (buildings, energy, shares, rooms,
aggregations), joined and shaped in memory. Every freshness question reduces to one thing:
**when the Pod changes, does the projection that depends on it refetch?** This note
collects the mechanisms the app relies on for that. The cache is **resource-oriented** —
one entry per Pod resource, keyed by its IRI ([`query-layer.md`](./query-layer.md)) — and
that keying *structurally* closes the class of staleness bug a screen-shaped fold used to
risk (described below, as the rationale for why the layer is keyed this way). The same
staleness class also exists on the *write* side — derived state stored **on the Pod** (the
`.acl` projection) rather than in the cache — audited at the end. Companion to
[`query-layer.md`](./query-layer.md) (how the cache is keyed and composed),
[`data-deref.md`](./data-deref.md) (what gets dereferenced and joined) and
[`storage-layout.md`](./storage-layout.md) (where it lives on the Pod).

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

The class of bug below is the one resource keying closes: a read whose cache key
doesn't cover all the Pod inputs it folds, so no write that changes those inputs is seen
to change the key, and the server-driven refetch never fires.

## Why per-resource keying closes it

The risky shape was a screen-shaped fold: a query folded a set of linked resources into one
derived value, keyed off the *identity of the set* (which items exist) rather than the
*content it folds* (which resources each item links). A Pod change that edited an item's
links without adding or removing an item left the key unchanged — and `staleTime: 0` +
`keepPreviousData` made the staleness *silent* (the eager refetch kept returning the same
key's cached fold).

Energy was the instance. `useEnergy` was one query keyed by the sorted building-id set, so
writing an energy year to an *existing* building changed a link but not an id, and the map
energy lens read stale. The fix is structural: there is no whole-set fold to under-cover
any more. Each building's energy is its own `["buildingEnergy", {webId}, {buildingUri}, …]`
query and each dataset its own `["energyDataset", {webId}, {datasetUri}]` entry
([`query-layer.md`](./query-layer.md)); an energy write invalidates the touched dataset
entry **by IRI**, so coverage falls out of the keying rather than out of a fingerprint that
has to enumerate the fold's inputs. The same holds for buildings (per-source entries) and
the sharing logs (per-event entries): the unit of the key is the resource, so the key
can't fail to cover the resource. The lone remaining fingerprinted key is a per-building
one (`buildingEnergyKeyFor`, a building's own dataset slugs) and the building-less
observations set — both fold a *single* subject's links, where the fingerprint and the
resource coincide.

## Audit of the other reads

The question to ask of any read: **"can a resource this query folds change on the
Pod without my key changing AND without a mutation invalidating it?"** If yes, the
projection can drift out of sync. Applying it to the query hooks (`queries.ts`):

- **`useEnergy`** / **`useBuildings`** / **`useAnnualEnergyByYear`** are now `useQueries`
  fan-outs over per-resource entries (one `buildingSource`/`buildingEnergy`/`energyDataset`
  per resource) folded by a `combine` selector. There is no whole-set key to under-cover;
  an edit invalidates the touched resource entry by IRI.
- **The sharing logs** (`useSharedInGrants` / `useSharedOutGrants`) are container-listing
  queries (`sharedInContainer` / `sharedOutContainer`) plus one immutable `sharingEvent`
  entry per event; every "shared with/by me" list is still a pure in-memory derivation of
  those, not a separate query. **Aggregation definitions** are likewise a container
  (`aggregationsContainer`) + one `aggregationDefinition` entry each. Adding/removing
  invalidates the container; editing content invalidates the per-resource entry.
- **`useRoomLog`** is keyed by the current room IRI; its event content changes from *own*
  writes are covered by direct invalidation (`queryKeys.roomLog`). But the membership log
  is also appended by **other** agents, which no local write sees — so the room detail page
  invalidates `roomLog` on open (the "look" refetch), mirroring the Share-tab readers. Keyed
  correctly, own content via invalidation, cross-agent content via the look.
- **`prefs`** / **`agents`** are single documents under a constant `["name", webId]` key —
  one resource, one query; freshness is mutation invalidation.
- **`useRooms`** is deliberately `staleTime: Infinity` and patched optimistically by the
  room mutations (a background refetch could revert an in-flight room switch). Intentionally
  outside the auto-refetch model.

The audit also surfaced **`useReceivedBenchmarks`** — a gap of the same *family* that
started in a different mechanism and was ultimately closed by the same construction as
energy. It folds the received snapshots (loads each one off the shared-in log and keeps
the benchmark ones), and first showed an *invalidation-coverage* gap: it was
constant-keyed, and the inbox drain (`useCheckInbox`) invalidated `sharedInLog`
and `buildings` but **not** `receivedBenchmarks`, so a benchmark snapshot
newly archived into `shared-in/` could be missing from the energy view's Benchmark column
until that query was otherwise remounted. It is now **derived-keyed** like energy: the key
is `[receivedBenchmarks, webId, fingerprint]` where the fingerprint is the sorted set of
received snapshot IRIs (`queries.ts`), so a grant arriving or leaving changes the key and
refetches by construction. The prefix invalidation is *kept* alongside (the inbox drain's
`onSettled` invalidates `queryKeys.receivedBenchmarks`) for the orthogonal case the key
can't see — a snapshot's *contents* changing while the received-set is unchanged (covered
by a `queries.test.ts` case). Key-coverage for set membership, invalidation for content:
the two mechanisms composed, not one standing in for the other.

## The write-side twin — projections stored on the Pod

The React Query cache is not the app's only derived projection. The WAC `.acl`
files are one too — derived from the `shared-out/` log *plus the current resource
tree under each granted scope* ([`queries-mutations.md`](./queries-mutations.md)
§materialized projection) — and the same staleness question applies: **which mutations change an
input to the projection without re-running it?** The inputs split cleanly:

- **The log itself** — covered: every share/revoke writes the `.acl` at the call
  site, and `reissueGrants` repairs drift in both directions after the fact.
- **The resource tree under a granted scope** — the under-covered input. A grant's
  *recorded scope* can be intensional ("this building, all energy years") while its
  *applied projection* is extensional (the per-dataset `.acl`s enumerated at apply
  time). Any mutation that creates a resource inside an intensionally-granted scope
  is then a projection input change with no projection update.

Auditing the resource-creating mutations against that question:

- **Attachment / certificate upload** into a shared building's `files/` — covered
  by construction: the share grants the *container* with `acl:default`, so later
  files inherit. The projection here is keyed on the scope, not its members —
  the write-side analogue of `energyKeyFor`.
- **`writeEnergyYear`** on a shared building — was the gap, now reconciled:
  energy grants are per-dataset `.acl`s (deliberately, so per-year grants stay
  enforceable) and `energy/` carries no default, so the write path runs
  `reconcileBuildingGrants` (share.ts) — fold `shared-out/` for active grants on
  the building, re-apply each per its *recorded* scope (all-years picks up the
  new dataset; per-year correctly leaves it outside). Record-free and idempotent,
  and best-effort in the mutation (the year is already saved, so a throttled ACL
  write must not fail the save) — a failed reconcile is residual drift, caught
  by the audit below and repaired by the log replay.
- **`deleteEnergyYear` / building delete** — removal is the benign direction: a
  dropped resource takes its `.acl` with it, and the delete path revokes
  recipients first; a stale grant on a missing resource is skipped by replay
  (`missing`).

The invariant the projection must satisfy is executable, because Tier 2 has two
real sessions: *a recipient can read exactly what the folded log says they may
read*, checked with recipient-side GETs. The `grant-projection` headless task
asserts it — exact at share time, kept exact by the write path
(`writeEnergyYear` + reconcile), the residual drift class (a bare write,
standing in for a failed best-effort reconcile) detected and then caught back
up to the log by `reissueGrants`. The same invariant is observable in the field through
`auditGrants` (`share.ts`), the dry-run diffing twin of the repair: it folds the
log, computes the expected projection through the SAME enumeration the repair
writes (`buildingGrantTargets` — one source of truth, so apply and audit cannot
disagree), reads the actual `.acl`s back, and reports the diff in both
directions (missing grants and lingering revoked ones) without writing. Surfaced
as the dev-mode "Check sharing consistency" action next to the rebuild; the
Tier-2 task uses it for full pair coverage where the recipient-side GETs sample.

## Invalidation cost — and the responsiveness it bounds

The sections above are about *coverage* — does a write's change reach the read. There
is a second axis the same contract implies: the **cost** of the refetch a write
triggers, which is what the UI's responsiveness is bounded by. TanStack Query's low
latency is the **client cache** — invalidate a key and the dependent components
re-render *from memory* instantly. It does **not** make the **Pod I/O** faster, and
because freshness is server-driven (`staleTime: 0`, conditional GET) there is no fresh
*cached* data after a write: reflecting the change means a network re-read.

The **archive restore** is the worst case, and a useful one to name. `useRestoreArchive`
runs `importArchive` (a **sequential** PUT per archived resource — buildings, energy
datasets, logs, prefs, aggregations, rooms, attachments), then `reissueGrants` (fold the
`shared-out/` log, rewrite an `.acl` per building), before anything settles; only then
does `onSettled` fire — and it calls **`qc.invalidateQueries()` with no key**, because
the restore "may have replaced anything under the app collection." That invalidates
*every* query, forcing a **full re-read** of the whole projection through the normal
dependent chain (storage root → `shared-in/` fold + `prefs` → list + GET each building →
phase-2 energy — [`data-deref.md`](./data-deref.md)), each a conditional GET subject to
`retryFetch` backoff. Throughout, `keepPreviousData` holds the *pre-restore* projection
on screen rather than blanking — so the change reads as a lag until the maximal re-read
lands. No optimistic patch is possible: the archive is opaque bytes the client never
modelled, so it is invalidate-then-refetch, at the coarsest possible grain.

So responsiveness here is bounded by Pod I/O — a long sequential write followed by the
*largest* re-read the app can issue — not by the query layer, which is doing its job
the instant data arrives.

The app now keys and invalidates at the grain of the **individual resource** (one entry per
source/dataset/event), so an ordinary write refetches only the resources it touched — the
container if structure changed, otherwise just the edited resource, the others staying warm.
The archive restore remains the coarsest point — `invalidateQueries()` with no key, because
the restore may have replaced anything — so it is the one place that still re-reads the whole
projection regardless of the per-resource keying. The grain of invalidation is what bounds
write responsiveness, and it is now fine everywhere except the deliberately-coarse restore.

## Two assemblies of the projection — the cached read and the headless read

Everything above describes one way the projection is built: the React Query read
hooks (`queries.ts`). There is a **second, parallel** assembly over the *same* data
layer — the intent **query** cores (`query(name, …)` / `READ_CORES` in
`intents/registry.ts`), used where a read is itself a user action or must run with no
component tree: the command palette, a deep link's `entityQuery.resolve(iri)`, an LLM
tool, a Tier-2 runner. The two are not stacked; they are parallel callers of the same
primitives, and they overlap almost entirely — diverging only in the assembly on top.

The shared core is identical on both paths: the deref + parse primitives `fetchFresh`
(conditional GET over the gateway) and `parseBuildings` (quads → `Building`), and
the collection loader `loadBuildings` / `loadEnergy`. The intent collection read
(`FindBuildings` → `fetchAndParseData`) calls the *same* `loadBuildings` the hooks do
([`data-deref.md`](./data-deref.md)). They diverge on three axes, all *above*
`loadBuildings`:

- **Caching / reactivity** — the hook path wraps the load in React Query: the cache,
  the freshness, and the invalidation-on-write this whole note is about. The intent paths
  read the **same warm cache** when the app is mounted (the `cachedBuilding` /
  `cachedVisibleBuildings` / `cachedSharingGrants` peeks, and the `fetch…Shared` accessors,
  over the published client — [`query-layer.md`](./query-layer.md)) and fall back to a
  direct load only when it is cold (fully headless / before the hook ran). So they reuse the
  projection rather than re-reading the Pod; they just don't subscribe to it.
- **Who folds the side-inputs** — `loadBuildings` needs two derived inputs, the
  shared-in source list and the hidden-prefs set. The hook path folds them as
  **separate cached queries** (`sharedInLog`, `prefs`) and passes them in, so each
  fold is cached and invalidated on its own; `fetchAndParseData` folds them **inline
  itself**, every call, because a headless caller has no cache. Same `loadBuildings`,
  different *suppliers* of its arguments.
- **Addressing** — the single-entity read (`GetBuilding` → `entityQuery.resolve`)
  skips discovery entirely: `fetchFresh` + `parseBuildings` on one known IRI, no
  container listing, no shared-in fold, no hidden filter (`isShared` is a storage-root
  check on the IRI). The collection reads discover-then-parse; this one parses one IRI.

So both front doors now read **one** projection — the same IRI-keyed cache — rather than
re-reading the Pod independently: the reactive hooks for what the screen renders, the
imperative cores for what the user invokes or a headless caller needs, both reaching the
warm entries through the published client. The remaining difference is only the *front
door's shape* (a collection fan-out vs a single-resolve, both over the same loaders and
selectors) and the cold-cache fallback a headless caller still needs. That convergence is
the realisation of the resource-keyed direction — there is no second cache to keep in step,
because there is one cache and TanStack is it ([`query-layer.md`](./query-layer.md)).

## The principle

Prefer making the refetch fall out of the data over making it fall out of
discipline. Keying a derived read on the inputs it actually folds keeps it in sync
by construction; relying on every mutation that touches a linked resource to
remember to invalidate the dependent key is the fragile alternative — it works
until one call site forgets. The write side obeys the same principle: a grant
applied to a *scope* (a container default) stays correct by construction; a grant
enumerated over a scope's *current members* must be re-run by every mutation that
grows the scope — which is what the write-energy-year reconcile does, with the
audit + replay pair as the safety net for the discipline-shaped remainder.
