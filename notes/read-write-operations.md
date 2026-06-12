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
the underlying Pod operations and the **storage models and projection disciplines**
below.

Each Pod-touching service-layer function carries an `@operation query` / `@operation
mutation` JSDoc tag marking which kind it is. That discriminator is the only tag today;
the richer classification (storage model, trigger, resource) and a generated inventory
are still to come — see [`plan-operation-annotations.md`](./plan-operation-annotations.md).

## Two storage models

A mutation commits against one of two storage models, distinguished by **where
authority (ground truth) lives**. The choice is not arbitrary but it is also not
signalled at the call site, so the governing rule is stated here: **overwrite
single-writer owned state in place (the default); event-source anything cross-agent
or needing an audit trail / replay; treat enforcement artifacts as projections of
the event log.**

### In-place resource — the default

GET → mutate the store → conditional PUT (`readModifyWrite`, If-Match). No event, no
history; the resource *is* the state. Right wherever the data has a single writer who
owns it:

- building master data and energy datasets (`uploadBuilding`, `updateBuilding`,
  `writeEnergyYear`, `deleteBuilding`, attachments).
- personal state files: `prefs.ttl`, `bookmarks.ttl`, `contacts.ttl`
  (`toggleHiddenBuilding`, `setCurrentRoom`, `addBookmark`, `addContact`, …).
- view definitions and computed snapshots (`createViewDefinition`,
  `storeComputedSnapshot`, `deleteView`).
- the WebID profile / org node (`saveOrganization`, `uploadOrgLogo`) — these GET-mutate-PUT
  the whole document rather than going through `readModifyWrite`, a minor variant of the
  same model.

### Event-sourced log

The escalation, chosen when in-place breaks down: several agents write the same
state (concurrent PUTs would clobber), or the history itself is the point (audit,
replay). Immutable events POSTed to an LDP container (the server mints each child
URI, so concurrent appends never clobber), never updated in place. The log is ground
truth; current state is always derived through a projection (next section).

- `shared-out/` — building & view grants/revocations the user issued (`recordSharing`,
  `recordViewSharing`).
- `shared-in/` — grants received, archived from the inbox (`appendSharingEvent`).
- `rooms/<id>/` — data-room membership (`setMembership`) and role (`setMyRole`) events.
- the inbox — cross-Pod notification events (`postSharingEventToInbox`).

Within the model there are two **delivery topologies**, chosen by whether the
affected party can read where the fact lives:

- **Shared container, pull** (the rooms): one container on the host's Pod that every
  participant can read and append to. Each participant posts events about themselves;
  nobody is notified — readers fold the container when they look. Events persist; the
  container *is* the log.
- **Inbox, push** (the sharing events): the fact (a grant) lives in the sharer's
  `.acl` and `shared-out/`, which the recipient cannot read — so a copy of the event
  is *delivered* into the recipient's inbox. The inbox is transport, not a log: the
  drain archives each message into the recipient's own `shared-in/` and deletes it,
  leaving the event recorded once per party.

So: append in place and fold when the audience can already reach the container; push
a copy when the authoritative record sits behind someone else's access control.

## Two projection disciplines

A log's derived state reaches its consumer through one of two disciplines, chosen by
**whether the consumer can fold the log itself**:

### Fold-on-read — the default

The projection is computed in memory each time a query reads the log, never
persisted; the consumer is the app. The fold queries (`foldSharingLog`,
`getRoomLogState`) are these projection reads: group events by key, keep the latest,
emit current state. Folding rules live in [`sharing.md`](./sharing.md) and
[`room.md`](./room.md).

### Materialized projection

Persisted as a Pod resource because the consumer cannot fold. The sole instance: the
WAC `.acl` files — the server's enforcement engine reads only `.acl`, so the
projection must be written where the enforcer looks. The `.acl` files are not ground
truth; they are an enforcement cache rebuilt from `shared-out/` by `reissueGrants` →
`applyBuildingGrant` → `grantReadAccess` / `removeFromACL`. A grant/revoke writes the
`.acl` at the call site (mechanically an in-place PUT) but the authoritative record
is the event in the log, and the ACL can be rebuilt from the log after an archive
restore. This split is deliberate and must stay replayable — see
[`sharing.md`](./sharing.md).

## A second axis — trigger

The storage models and projection disciplines above classify mutations by
*mechanism*. Mutations also split, orthogonally, by *trigger*:

- **User-intent** — the mutation records a decision a person made (share, revoke, edit a
  building, join a room). Almost every mutation is this.
- **Reconciliation** — system-initiated, derived from observed state rather than from any
  user action: the app notices an inconsistency and writes to close it.

The axes compose: a reconciliation mutation still commits through the same mechanisms.
The reconciliation mutations are a small family — the stale-grant prune in `loadBuildings`
(event-sourced: appends a self-revocation to `shared-in/` when a shared source 403/404s),
the ACL rebuild in `reissueGrants` (materialized projection: regenerates `.acl` from
the log), and the grant extension in `reconcileBuildingGrants` (materialized
projection: a new energy year grew a granted scope,
so the active grants on that building are re-applied per their recorded scope — run
best-effort inside the write-energy-year mutation, since the year is already saved when
it runs). They are the mutations that legitimately live inside a query, a restore path
or another mutation rather than behind their own user action, because their whole job is
to make a projection match reality.

## Queries

Read-only operations group by *how* they read, which mirrors the write side:

- **Direct GET / container LISTING** — read state written in place. Per-resource GETs
  (`getViewDefinition`, `resolveAgent`, `readPrefs`) and container listings
  (`discoverOwnBuildings`, `getViewDefinitions`). The phase-2 energy reads are this kind:
  `loadEnergyDatasets` (`energyDataset.ts`) fetches the annual datasets a building links,
  and `parseTtlReadings` (`userEnergyParser.ts`) fetches one daily file of a 15-minute
  series — both keyed off refs parsed in phase 1, and both taking the authed transport as
  a `fetchFn` argument rather than a `Session` (load phasing in
  [`data-deref.md`](./data-deref.md)).
- **Log fold** — the fold-on-read projection of an event log (`foldSharingLog`,
  `getRoomLogState`, `getSharedWithMe`, `getReceivedViews`).

A query is otherwise pure. Freshness is server-driven via `fetchFresh` (revalidating GET);
React Query owns caching and invalidation.

Queries split by *consumption shape*, which decides their hook home:

- **Subscriptions** — a mounted component declares a standing data need; the read
  re-runs when a mutation invalidates its key. The `queries.ts` hooks; the normal case.
- **Imperative read-intents** — a user *invokes* a read as an action with its own
  feedback surface, and the answer must be fresh per invocation (caching an audit
  would report stale consistency): `auditGrants` ("Check sharing consistency"),
  `exportArchive` ("Download archive"), the wipe preview (`listContainedResources`)
  and the restore preview (`inspectArchive`). The two Pod-reading ones are reified as
  hooks (`useAuditGrants`, `useExportArchive`) on the `useMutation` *primitive* — used
  here purely as the on-demand trigger (busy state + the central error toast), not as
  a write; they stay `@operation query` and invalidate nothing. The previews stay
  plain service calls inside their confirmation flows.

## Account-scope operations

The dashboard's account actions cover whole-collection ground the per-entity catalog
doesn't, but they classify with the same axes — no third storage model is needed:

- **Demo seeding** (`seedDemoBuildings`, `seedDemoContacts`, `seedDemoRooms`) —
  user-intent in-place bulk creates. Integrity is ordering, not transactions: per
  building, datasets first and the discoverable building file LAST (the commit
  point), so a failure leaves only inert orphans and a retry mints fresh UUIDs.
  Per-item best-effort with a tally outcome (`{seeded, total}`) — partial success is
  a *result* the caller renders ("Added N of M"), not an error.
- **`removeAppData`** — user-intent terminal in-place mutation: the recursive,
  depth-first delete treats every resource — event logs, in-place state, ACL
  projections alike — uniformly as state to destroy; nothing is appended, folded or
  projected. Long-running and cancellable (abort signal; a cancel resolves as the
  outcome `{aborted: true}`). Its invalidation is the entire cache (`qc.clear()`),
  on every settle: success leaves an empty Pod, an abort or failure an unknown
  partially-deleted subset — either way nothing cached can be trusted. The
  confirmation embeds a query (`listContainedResources` enumerates what will be
  lost).
- **`importArchive` (restore)** — user-intent in-place bulk write with an *embedded
  reconciliation*: the archive carries the `shared-out/` log (ground truth) but not
  the derived `.acl` files, so the restore mutation runs `reissueGrants` as part of
  the same intent, then invalidates everything.
- **`reissueGrants` ("Rebuild sharing from log")** — the materialized-projection reconciliation
  reachable behind its own user-intent button (the same function the restore embeds).
  No invalidations: it writes only the ACL projection, which no query reads.
- **`exportArchive` / `auditGrants`** — user-intent queries (read-intents above).

All six now go through hooks in `mutations.ts` (the account actions were the last
hand-rolled handlers); what stays at the call site is exactly the UI these intents
need beyond the standard busy/toast shape — the computed-preview confirms, the
full-page activity screen, and outcome rendering.

## The round-trip at runtime

The taxonomy above is static — what each operation *is*. At runtime a query and a
mutation are the two halves of one round-trip between the UI and the Pod, and they meet
in the React-Query cache rather than calling each other.

- A **mutation** runs from a user action: an event handler calls a `mutations.ts` hook,
  which wraps the service function that commits through one of the storage models. On
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

Three operations are shaped like queries but contain a mutation — the one place the app
violates Command–Query Separation. Each embeds a reconciliation mutation (see the trigger
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
- `useViewDetail` (`queries.ts`) — the standalone view page's query —
  **auto-materialises a missing snapshot** (`refreshSnapshot`) when the definition
  exists but no snapshot does, so a freshly created view renders its chart on first
  open instead of an empty "Refresh Snapshot" prompt. Like the prune it is
  exceptional, not per-call: a present snapshot keeps the read pure (absence is a
  definitive 404 — a transient read failure throws and can never trigger the write),
  and it is best-effort (a failed compute degrades to a definition-only result
  carrying the error for the page to surface inline).

These are the exceptions to "a query is pure"; the rest of the read surface holds the
line. That the reconciliation mutations exist is fine — they belong in query/restore
paths. The seam is only that these three carry query-shaped names; see
[`plan-operation-seams.md`](./plan-operation-seams.md).
