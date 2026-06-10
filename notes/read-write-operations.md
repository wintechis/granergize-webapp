# Read and write operations — queries and mutations

How the app's operations are organised. Following **Command–Query Separation**, every
operation is one of two kinds:

- a **query** — looks up Pod state and returns it, no observable side effect; and
- a **mutation** — changes Pod state (the *command* side of CQS).

Companion to [`architecture.md`](./architecture.md) (the source layers these operations
live in), [`storage-model.md`](./storage-model.md) (the registry-free / log-folding
design), [`sharing.md`](./sharing.md) (the sharing event logs),
[`data-layout.md`](./data-layout.md) (the on-Pod tree) and
[`data-deref.md`](./data-deref.md) (fetch/load mechanics).

The terminology is already the codebase's: queries live behind React Query hooks in
`src/hooks/queries.ts`; mutations behind `src/hooks/mutations.ts`, a thin invalidation
layer over the service functions that do the real work. This note maps that split onto
the underlying Pod operations and the **three mutation models** below.

Each Pod-touching service-layer function carries an `@operation query` / `@operation
mutation` JSDoc tag marking which kind it is. That discriminator is the only tag today;
the richer classification (model, trigger, resource) and a generated inventory are still
to come — see [`plan-operation-annotations.md`](./plan-operation-annotations.md).

## Three mutation models

A mutation commits through one of three mechanisms. The choice is not arbitrary but it is
also not signalled at the call site, so the governing rule is stated here:
**event-source anything cross-agent or needing an audit trail / replay; overwrite
single-writer owned state in place; treat enforcement artifacts as projections of the
event log.**

### 1. Event-sourced append-only logs

Immutable events POSTed to an LDP container (the server mints each child URI, so
concurrent appends never clobber), never updated in place, *folded* by a query to derive
current state. The log is ground truth.

- `shared-out/` — building & view grants/revocations the user issued (`recordSharing`,
  `recordViewSharing`).
- `shared-in/` — grants received, archived from the inbox (`appendSharingEvent`).
- `rooms/<id>/` — data-room membership (`setMembership`) and role (`setMyRole`) events.
- the inbox — cross-Pod notification events (`postSharingEventToInbox`).

The fold queries (`foldSharingLog`, `getRoomLogState`) are the matching projection reads:
group events by key, keep the latest, emit current state. Folding rules live in
[`sharing.md`](./sharing.md) and [`room.md`](./room.md).

### 2. Direct in-place mutation

GET → mutate the store → conditional PUT (`readModifyWrite`, If-Match). No event, no
history; the resource *is* the state. Used for single-writer owned data:

- building master data and energy datasets (`uploadBuilding`, `updateBuilding`,
  `writeEnergyYear`, `deleteBuilding`, attachments).
- personal state files: `prefs.ttl`, `bookmarks.ttl`, `contacts.ttl`
  (`toggleHiddenBuilding`, `setCurrentRoom`, `addBookmark`, `addContact`, …).
- view definitions and computed snapshots (`createViewDefinition`,
  `storeComputedSnapshot`, `deleteView`).
- the WebID profile / org node (`saveOrganization`, `uploadOrgLogo`) — these GET-mutate-PUT
  the whole document rather than going through `readModifyWrite`, a minor variant of the
  same model.

### 3. ACLs as a derived projection

WAC `.acl` files are not ground truth; they are an enforcement cache rebuilt from
`shared-out/` by `reissueGrants` → `applyBuildingGrant` → `grantReadAccess` /
`removeFromACL`. A grant/revoke writes the `.acl` at the call site (so it *looks* like
model 2) but the authoritative record is the event in model 1, and the ACL can be
rebuilt from the log after an archive restore. This split is deliberate and must stay
replayable — see [`sharing.md`](./sharing.md).

## A second axis — trigger

The three models above classify mutations by *mechanism*. Mutations also split,
orthogonally, by *trigger*:

- **User-intent** — the mutation records a decision a person made (share, revoke, edit a
  building, join a room). Almost every mutation is this.
- **Reconciliation** — system-initiated, derived from observed state rather than from any
  user action: the app notices an inconsistency and writes to close it.

The two axes compose: a reconciliation mutation still uses one of the three mechanisms.
The reconciliation mutations are a small family — the stale-grant prune in `loadBuildings`
(model 1: appends a self-revocation to `shared-in/` when a shared source 403/404s) and
the ACL rebuild in `reissueGrants` (model 3: regenerates `.acl` from the log). They are
the mutations that legitimately live inside a query or a restore path rather than behind
a user action, because their whole job is to make a projection match reality.

## Queries

Read-only operations group by *how* they read, which mirrors the three mutation models:

- **Direct GET / container LISTING** — read state written by model 2. Per-resource GETs
  (`getViewDefinition`, `resolveAgent`, `readPrefs`) and container listings
  (`discoverOwnBuildings`, `getViewDefinitions`). The phase-2 energy reads are this kind:
  `loadEnergyDatasets` (`energyDataset.ts`) fetches the annual datasets a building links,
  and `parseTtlReadings` (`userEnergyParser.ts`) fetches one daily file of a 15-minute
  series — both keyed off refs parsed in phase 1, and both taking the authed transport as
  a `fetchFn` argument rather than a `Session` (load phasing in
  [`data-deref.md`](./data-deref.md)).
- **Log fold** — read a projection of a model-1 event log (`foldSharingLog`,
  `getRoomLogState`, `getSharedWithMe`, `getReceivedViews`).

A query is otherwise pure. Freshness is server-driven via `fetchFresh` (revalidating GET);
React Query owns caching and invalidation.

## The round-trip at runtime

The taxonomy above is static — what each operation *is*. At runtime a query and a
mutation are the two halves of one round-trip between the UI and the Pod, and they meet
in the React-Query cache rather than calling each other.

- A **mutation** runs from a user action: an event handler calls a `mutations.ts` hook,
  which wraps the service function that commits through one of the three models. On
  success the hook does not hand a result back to the UI — its job is the write plus
  **invalidating its query keys**.
- A **query** runs because a mounted component subscribes through a `queries.ts` hook;
  the service function reads (direct GET / listing, or a log fold) and React Query caches
  the result under a WebID-namespaced key, serving it until something invalidates it.

The loop closes through the cache: a mutation never repaints the screen directly, it
invalidates keys; the dependent queries refetch; and *those* re-render the components
that read them. This is the operations-layer face of the render cycle in
[`architecture.md`](./architecture.md) — CQS here is the same safe/unsafe split that
drives the UI there. Freshness is server-driven (`fetchFresh` revalidates); the only
trigger for a refetch is a mutation's invalidation.

## Seams — queries that hide a mutation

Two operations are shaped like queries but contain a mutation — the one place the app
violates Command–Query Separation. Both embed a reconciliation mutation (see the trigger
axis above), kept in the query path so the app self-heals without an explicit cleanup
step:

- `loadBuildings` (`TurtleParsingService.ts`) detects inaccessible shared sources
  (403/404) and **appends revocation events to `shared-in/`** to prune them
  (`removeInaccessibleBuildingSources`). A query mutates an event log. The prune is
  exceptional, not per-call: on the happy path (every source accessible) it performs no
  write, and each append is best-effort (failures are logged, never thrown).
- `drainInbox` (`inbox.ts`) drains the inbox: copies each message into `shared-in/`, then
  DELETEs it. Named and called like a refresh, it is in fact a destructive move — and
  unlike the prune it writes on every call that finds messages.

These are the exceptions to "a query is pure"; the rest of the read surface holds the
line. That the reconciliation mutations exist is fine — they belong in query/restore
paths. The seam is only that these two carry query-shaped names; see
[`plan-operation-seams.md`](./plan-operation-seams.md).
