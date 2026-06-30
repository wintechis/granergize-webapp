# The query layer (resource-oriented cache)

How the app caches what it reads from the Pod, and how that cache is kept fresh against
Pod writes. The Pod is ground truth; the client holds a **cached, derived projection** of
it. This note describes the *shape* of that cache — how it is keyed and composed — and its
*freshness* — when the projection refetches. Companion to
[`queries-mutations.md`](./queries-mutations.md) (the read/write taxonomy and storage
models, incl. the WAC `.acl` materialized projection's own staleness),
[`data-deref.md`](./data-deref.md) (what is fetched, in what order) and
[`object-model.md`](./object-model.md) (the domain shapes the reads produce).

## The cache mirrors the resource graph, not the screens

The cache is **resource-oriented**: it holds entries that correspond to Pod resources —
an `ldp:Container` listing, a building document, an energy dataset, a sharing-log event —
each keyed by its IRI, holding a value parsed close to the triples. The domain shapes a
screen wants (a `Building[]`, the energy table, the folded grant set) are **not** stored;
they are **derived at the edge** from the resource entries, in memory, each render.

This is normalised caching, the shape an LDP/Solid client naturally wants: the client
mirrors a slice of the Pod's container/resource graph rather than mirroring particular
views. It replaced an earlier design in which a read was one monolithic loader that
discovered, fetched, parsed and composed many resources into a single screen-shaped value
keyed by a coarse content fingerprint. The monolith's failure mode was that a consumer
needing a *different* shape, or *fresher* data, re-read the Pod independently — and the
independent read raced or diverged from the warm copy the rest of the app already held.

The transport underneath is unchanged: the authed `getGateway()` fetch, the
revalidating conditional GET (`fetchFresh`, so an unchanged resource is a cheap `304`),
retry/throttle. This layer reshapes *what* is cached and *how it is keyed*, not how a
byte is fetched.

## Principles

resource-keyed
: one cache entry per Pod resource, keyed by its **IRI**; the value is the parsed store
  or a thin typed projection with canonical (vocabulary) keys — no display labels.

containers-as-queries
: an `ldp:Container` is an entry over its `ldp:contains` listing → child IRIs. A
  membership change (a resource added/removed) refreshes the *container* entry; a content
  change refreshes the *resource* entry.

derive-at-edge
: the domain shapes — `Building[]`, the labelled energy table, the folded shares — are
  memoised **selectors** over resource entries, never persisted in the cache. Labels and
  groupings are applied at render.

single-read-path
: every consumer (map, dialog, the aggregation compute) reads the **same** resource
  entry. Nothing re-reads its own copy, so there is no second read to race or diverge.

per-resource-freshness
: staleness and invalidation are keyed by IRI. A write refreshes exactly the resources it
  touched (and the container if structure changed). An immutable resource (a sharing-log
  event) is held with no time-based expiry and refreshed only by invalidation.

## Layering

A read flows through four bands:

- **Consumers** — pages, dialogs, the map — read app shapes through a hook and never see
  the resource entries directly.
- **Hooks + selectors** — a hook fans out over the relevant resource entries and folds
  them into the app shape with a pure **combine selector** (derive-at-edge). The hook's
  external result shape (`{ data, isLoading, isFetching, error }`) is preserved across the
  internal reshaping, so consumers are insulated from it.
- **Resource entries** — IRI-keyed cache entries (container listings and per-resource
  reads). This is the band the rest of the note is about.
- **Loaders + parsers** — React-free functions that fetch one resource and parse it. They
  are shared by the reactive hooks **and** the headless orchestrators, so the app and the
  offline/test path cannot drift in how a resource is read or shaped.

## The resource entries

The entries are identified by a small catalogue of key prefixes; the full key namespaces
each by the reader's WebID (so a re-login cannot read another user's cache) and then by
the resource IRI. The current entries:

- a building source document → its `Building[]` (one source can carry several buildings;
  a foreign document, more than one).
- the own-buildings container listing → the IRIs of the user's building documents.
- an energy dataset document → its canonical `EnergyDataset`.
- a sharing-log container listing → the IRIs of its event resources; and one entry per
  **event** → that event's parsed records. Events are immutable (append-only,
  server-minted IRIs), so an event entry is never refreshed by time.
- the aggregation-definitions container listing → the IRIs of the definition documents;
  and one entry per **definition** → its parsed `AggregationDefinition`.

A hook composes these. The buildings view fans out over the own container ∪ the shared
sources, reading one source entry each, and the selector merges them, applies the hidden
filter and marks ownership. The energy view fans out per building. A sharing log lists its
container, reads each event entry, and the selector folds the events to the active grants.

## Selectors preserve the consumer contract

Each hook returns the same `{ data, isLoading, isFetching, error }` it always did. The
fan-out's combine produces the app shape plus an aggregate load/error state; a thin
adapter then decides the public `data`: it stays *absent* through the whole gated and
first-load window (so a dependent "is it loading" reads true and an empty state does not
flash), but once any resource has produced data, adding a further resource keeps the
existing list on screen rather than blanking it. The selector identity is kept stable
(memoised on a fingerprint of its inputs) so a consumer that puts the derived value in a
dependency list does not churn every render.

## Reads are pure; writes are reconciliation

A selector never writes. Where reading a resource reveals that a projection has drifted
from reality — a shared source whose access was revoked, so the grant the log still
asserts must be withdrawn — the **read** only *collects* that observation, and a separate
**effect** performs the withdrawal (and any user-facing notice), guarded so it fires at
most once per resource. This keeps the query/mutation split honest (see
[`queries-mutations.md`](./queries-mutations.md) §Seams for the few documented places a
read still materialises state). The headless fold, which has no effect layer, keeps its
reconciliation inline — the one place that exception lives.

## Freshness and invalidation

There is no push from the Pod, so the projection is kept in step by four deliberate
mechanisms (centralised in `QueryProvider` and the hooks):

- **server-driven freshness** — `staleTime: 0` plus a revalidating conditional GET
  (`fetchFresh`, so an unchanged resource is a cheap `304`). The app never fabricates a
  freshness window; it asks the server and lets the validator decide. (Immutable resources
  — sharing-log events — opt out with no time expiry, refreshed only by invalidation.)
- **write-driven refetch** — the only thing that changes Pod state from the app is a
  mutation, and each invalidates the keys it affects (`mutations.ts` → `queryKeys`). A read
  not invalidated by a write that changes its inputs will not refresh on its own.
- **last-good-wins** — `keepPreviousData`, so an in-flight or failed refetch keeps the last
  good projection on screen rather than flashing empty.
- **read-time reconciliation** — container listings can lag their members, so some reads
  correct rather than trust one response (a delete polls the listing until the file is gone;
  a load `404`-prunes an inaccessible shared source — *Reads are pure* above).

Three consequences of the resource keying: a content edit invalidates one resource entry,
not a whole screen's fold; a structural change (a building added, a new share) invalidates
the **container** listing, leaving the resource entries it points at warm so the refold
reads only the new resource; and a projection over only derived state (hiding a building, a
preference edit) refreshes by re-running the selector — nothing is refetched.

**Why a derived read can't under-cover its inputs.** The hazard a screen-shaped fold risked:
a key that captured the *identity of a set* (which items exist) but not the *content it
folded* (which resources each item links), so an edit to an item's links left the key
unchanged and the refetch never fired — silently, under `staleTime: 0` + `keepPreviousData`.
Resource keying closes it structurally: the unit of the key is the resource, so a write
invalidates the touched resource **by IRI**; there is no whole-set fold whose key could miss
it. (Energy was the instance — one query keyed by the building-id set missed an energy-year
write to an existing building; it is now a per-building / per-dataset fan-out.)

The reads, audited against *"can a resource this folds change on the Pod without my key
changing AND without a mutation invalidating it?"*:

- `useBuildings` / `useEnergy` / `useAnnualEnergyByYear` are fan-outs over per-resource
  entries — no whole-set key to under-cover.
- the sharing logs and aggregation definitions are container + per-resource (event /
  definition) entries; add/remove invalidates the container, content the per-resource entry.
- `useRoomLog` is keyed by the room IRI; *own* writes invalidate it directly, and because
  the membership log is also appended by **other** agents, the room page invalidates it on
  open (the "look" refetch) — keyed correctly, own content via invalidation, cross-agent
  content via the look.
- `receivedBenchmarks` is derived-keyed on the sorted set of received snapshot IRIs (a grant
  arriving/leaving changes the key by construction), with a prefix invalidation kept
  alongside for the orthogonal case — a snapshot's *contents* changing while the set is
  unchanged.
- `prefs` / `agents` are single documents under a constant key (freshness is mutation
  invalidation); `useRooms` is deliberately `staleTime: Infinity`, patched optimistically by
  the room mutations (a background refetch could revert an in-flight room switch).

Cross-reader concern: an event log a *different* agent appends to is not discovered until the
inbox drain or the next login refreshes its container (see [`room.md`](./room.md) and the
sharing interop in [`queries-mutations.md`](./queries-mutations.md) for where a reader's
"look" must invalidate).

## Invalidation cost

Invalidation is a client-cache operation — invalidate a key and the dependent components
re-render from memory instantly — but it does not make the **Pod I/O** faster, and with
server-driven freshness there is no fresh *cached* data after a write: reflecting the change
is a network re-read. Per-resource keying makes that re-read minimal — a write refetches only
the resources it touched, the rest staying warm. The one deliberately-coarse point is the
**archive restore**: it may have replaced anything under the app collection, so it
invalidates *everything* (`invalidateQueries()` with no key) and re-reads the whole
projection through the dependent chain — `keepPreviousData` holds the pre-restore view until
the maximal re-read lands. No optimistic patch is possible: the archive is opaque bytes the
client never modelled.

The principle throughout: prefer making the refetch **fall out of the data** — key a derived
read on the resources it folds and it stays in sync by construction — over making it fall out
of **discipline**, every mutation remembering to invalidate a dependent key, which works
until one call site forgets.

## Trade-offs

Resource keying is normalised caching, so there are *more, smaller* entries than the old
screen-shaped folds — relied on rather than fought: React Query's structural sharing and
`gcTime` keep that cheap, and net fetch volume *drops* (each resource is read once and
reused, not re-read per consumer). Container→children reads can **waterfall**; the fan-outs
read the children from the container result with bounded concurrency (the `mapPooled`
pattern), not lazily per render. The mutation side is unchanged in spirit — writes commit
against the storage models ([`queries-mutations.md`](./queries-mutations.md)) and
invalidate — but invalidation shrinks from whole-fold fingerprints to resource IRIs. The
transport (the gateway, retry, `fetchFresh` revalidation) is untouched: this reshapes
*what* is cached and *how it is keyed*, not the fetch plumbing.

## The source-facing port (read-only external sources)

The same cache holds a second resource family: the **read-only external sources** — the
geo/region wrappers, regionalstatistik, weather, the area profile — reached through a
distinct `SourceGateway` (no auth, its own CORS/retry), keyed by the source identifier
(an IRI, an AGS, a station id). Their keys live in their own catalogue,
`services/sources/sourceKeys.ts`, kept apart from the Pod `queryKeys` on purpose: that one
is the *invalidation contract* (every key is invalidated by a mutation), whereas source
entries are **never write-invalidated** — the data is immutable or slow-changing, so they
carry a long/`Infinity` `staleTime` and refresh only by time. A non-hook reader shares a
warm source entry the same way it shares a Pod one — through an `ensureQueryData` accessor
(e.g. `fetchRegionAgsShared`) — so there is one cache, not a private per-service memo.

## Where the parts live

The key catalogue and the hook wiring (the fan-outs and combine selectors) are in the
hooks layer; the React-free loaders and parsers are in the service packages by subject —
building sources, energy datasets and the sharing log each under
`services/{building|energy|interop}/`. There is intentionally no single "query layer"
package: the *keys* and *reactivity* live with the hooks, the *resource reads* live with
the data they read, and the two are bridged by a published client handle so non-hook
service code can read the same warm entries the hooks filled.

## TanStack Query *is* the IRI-keyed store

There is no bespoke cache: the resource entries are ordinary React Query entries keyed by
IRI, and the read-through is `ensureQueryData`. React Query supplies the store, the
in-flight dedup, garbage collection, structural sharing and the reactivity binding — so
nothing here reimplements those. The "store" and the "query library" are the same thing.

## One read path for the UI *and* the intents

The published client handle lets React-free code read the warm entries through small peeks
(`cachedBuilding` / `cachedVisibleBuildings`, `cachedSharingGrants`, and the
`fetch{Resource}Shared` accessors), so both surfaces converge on the same cache rather than
re-reading the Pod:

- the **UI** reads through the hooks (the fan-outs populate and read the entries);
- the **intent read cores** (the headless object-model reads behind the command palette)
  read the same entries when the app is mounted, and fall back to a direct load only when
  the cache is cold (fully headless / before the relevant hook ran);
- the **aggregation compute** likewise reads the warm per-building / per-dataset entries.

Writes already share one path — the UI mutation hooks are thin adapters over the same
write cores the intents invoke. The few reads that stay independent do so on purpose: an
audit that must diff *actual* enforcement state against the log reads fresh ground truth,
and an external open-data lookup has no Pod entry to share.
