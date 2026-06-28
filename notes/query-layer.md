# The query layer (resource-oriented cache)

How the app caches what it reads from the Pod. The Pod is ground truth; the client holds
a **cached, derived projection** of it. This note describes the *shape* of that cache —
how it is keyed and composed. Companion to
[`app-pod-state-sync.md`](./app-pod-state-sync.md) (when the projection refetches),
[`queries-mutations.md`](./queries-mutations.md) (the read/write taxonomy and storage
models), [`data-deref.md`](./data-deref.md) (what is fetched, in what order) and
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

Freshness is write-driven, not time-driven (the convention in
[`app-pod-state-sync.md`](./app-pod-state-sync.md)). A mutation invalidates the keys it
affected; an active entry then refetches. Three consequences of the resource keying:

- A content edit invalidates one resource entry, not a whole screen's fold.
- A structural change (a building added, a new share) invalidates the **container**
  listing; the unchanged resource entries it points at stay warm, so the refold reads only
  the new resource. A container listing reuses the prior whole-fold key, so the existing
  invalidation sites carry over unchanged.
- A projection that depends only on derived state (hiding a building, which is a preference
  edit) refreshes by re-running the selector — no resource is refetched at all.

Cross-reader concerns are unchanged in spirit: an event log a *different* agent appends to
is not discovered until the inbox drain or the next login refreshes its container
(see [`sharing.ts` interop in `queries-mutations.md`](./queries-mutations.md) and
[`room.md`](./room.md) for where a reader's "look" must invalidate).

## Where the parts live

The key catalogue and the hook wiring (the fan-outs and combine selectors) are in the
hooks layer; the React-free loaders and parsers are in the service packages by subject —
building sources, energy datasets and the sharing log each under
`services/{building|energy|interop}/`. There is intentionally no single "query layer"
package: the *keys* and *reactivity* live with the hooks, the *resource reads* live with
the data they read, and the two are bridged by a published client handle so non-hook
service code (the aggregation compute) can read the same warm entries the hooks filled.
