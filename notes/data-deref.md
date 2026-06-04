# Data dereferencing & lookups

How the app turns a logged-in WebID into in-memory buildings/agents/energy: which
resources it dereferences, in what order, and how references between resources are
resolved. Companion to [`data-layout.md`](./data-layout.md) (where things live on
the Pod) and [`data-schema.md`](./data-schema.md) (the shapes of what's fetched).

Line references drift — treat them as signposts, not coordinates.

## The model in one line

**Registry-indexed bulk fetch + in-memory join** — not Linked Data
*follow-your-nose* (dereference each IRI as you meet it) and not a SPARQL
endpoint. A per-user registry says *which* documents to fetch; the app fetches
them concurrently, parses each into a provenance-tagged graph, and resolves
references between them in memory.

## The dereferencing primitive: `session.fetch`

Every read/write goes through the authenticated `fetch` from
`@inrupt/solid-client-authn-browser`. It's a drop-in `fetch` that attaches a
**DPoP-bound OAuth access token + a per-request DPoP proof**, so the Solid server
authorises the request against the user's WebID. Public resources also work
unauthenticated; private ones need the token; cross-origin reads (a source on
another Pod) additionally need that server's CORS + ACL to permit you.

One thin wrapper sits on top: `fetchFresh(url, session)`
(`src/services/utils/podFetch.ts`) — appends a `?t=<timestamp>` cache-buster and
`cache: "no-store"` so read-modify-write cycles see current state. RDF parsing
still uses the **query-less** URL as the `baseIRI`.

All Pod requests are funnelled through `session.fetch`, which is wrapped once at
login (`instrumentSessionFetch`, `networkActivity.ts`) so every dereference shows
up in the header activity indicator.

## The discovery chain — *what to fetch*

Resolved once per session, then cached:

1. **WebID → storage root.** `resolveStorageRoot(session)`
   (`src/services/utils/solidUtils.ts`) GETs the WebID profile document, parses it
   with n3, and reads `<webId> pim:storage <root>`. Throws if absent — there is no
   WebID string-munge fallback. Cached so the many synchronous callers stay simple.
2. **Storage root → fixed paths.** `podResources(webId)` returns every app path as
   `<root>granergize/…` (`dataSources.ttl`, `buildings/`, `hiddenBuildings.ttl`,
   `views/…`, `sharingRegistry.ttl`, …). One tree; no per-call base munging.
3. **Registry → source URLs + roles.** `getSourceRegistry`
   (`src/services/TurtleParsingService.ts`) GETs `dataSources.ttl`, parses it, and
   reads `gran:hasBuildingDataSource` / `gran:hasAgentDataSource` (the building /
   agent file URLs) plus each source's `gran:dataSourceRole`. **These URLs may live
   on other Pods.** A fresh Pod is bootstrapped here (empty registry +
   `seedDemoBuildings`).
4. **Fetch each source.** `loadTtlFromMultipleSources` fetches all sources
   **concurrently** (`Promise.all`). Inaccessible sources (403/404) are tolerated
   and pruned; an all-401 result throws `SessionExpiredError` (see Failure modes).

So "lookup" here means *consult the registry to discover the document set* — the
registry is the index of what to dereference.

## Parsing each document into a graph

For every fetched Turtle file (`loadTtlFromMultipleSources`):

- Parse with `new Parser({ baseIRI: url })` — **relative IRIs resolve against the
  file's own URL**, the standard RDF dereference semantic.
- Rewrite each quad so its **named graph = the source URL** — provenance: which
  file each triple came from.
- **Scope blank nodes** by prefixing them with the source URL, so `_:obs0` from two
  different files can't collide once merged.
- Merge everything into one n3 `Store`.

The merged graph is then **projected into typed JS objects** (`BuildingType` etc.)
via the predicate→field maps in `buildingConfig.ts` — a one-way, load-time
translation after which components see no RDF. That mapping, and the fact that the
RDF schema and the app-object schema are maintained in parallel, is documented in
[`data-schema.md` → "Two schemas: RDF graph ⇄ app objects"](./data-schema.md).

## Resolving references — *resolving an IRI to its data*

Once parsed, references between resources are resolved **in memory against the
merged graph — the app does not re-dereference each IRI it encounters**:

- `parseBuildings` (`src/services/utils/buildingParser.ts`) walks the quads into a
  `Map<id, BuildingType>`. The **building id** comes from the subject IRI via
  `extractBuildingIdStrict` (the `#fragment`, or the `…/buildings/<id>` path
  segment). Blank-node sub-structures (energy datasets, operating costs,
  certifications, SOSA observations) are stitched back to their building through
  blank-node→building maps built during the walk.
- Cross-references such as `rec:operatedBy` / `schema:customer` are kept as IRIs and
  resolved against the in-memory **agents** map (and rendered as in-app links). The
  app does *not* fetch each agent IRI on its own.
- **Energy** dispatches on the declared `gran:granularity`: aggregates are
  bulk-loaded with the building; sub-hourly series are **lazy-loaded on demand**
  (on building click) rather than eagerly dereferenced.
- The UI exposes two ways to act on an IRI: `RefLink` (in-app router navigation,
  resolved against already-loaded data) and `UriLink` (opens the raw resource in a
  new tab — i.e. lets the browser dereference it). See
  `src/components/detail/DetailView.tsx`.

A two-phase load (`fetchAndParseData`'s `onBuildingsAndAgents` callback) hands
buildings + agents to the UI first, then streams energy in.

## Writes — dereference, then conditionally replace

Mutations use `readModifyWrite` (`src/services/utils/podWrite.ts`): GET (capturing
the `ETag`) → mutate the n3 Store → PUT guarded by `If-Match` (or `If-None-Match: *`
for a create), retrying on `412`. Optimistic locking, so a concurrent writer can't
be silently clobbered. The data-room event log is the exception: it appends with
LDP `POST` to a container (race-free by construction) instead of rewriting a file.

## Failure modes

- **401 (expired token)** — `loadTtlFromMultipleSources` throws
  `SessionExpiredError`; `QueryProvider` notifies "Session expired — please log in
  again" and `keepPreviousData` keeps the last-loaded data instead of blanking the map.
- **403 / 404 (inaccessible / missing source)** — tolerated; that source is pruned
  and the rest of the load proceeds.
- **412 (write conflict)** — `readModifyWrite` re-reads and retries, then surfaces
  `ConflictError`.

## What this is NOT (and the alternatives)

- **Not follow-your-nose.** A Comunica/LDflex-style engine would dereference linked
  IRIs on demand and could run SPARQL across the web of documents. Here the registry
  is the explicit document set and joins happen in JS.
- **Not a SPARQL endpoint.** Reads are whole-document GETs of Turtle files, parsed
  client-side.
- **HTTP cache is still bypassed, but there is now a client query cache.** The
  read path is wrapped in **TanStack React Query** (`src/hooks/queries.ts`,
  `QueryProvider`): caching, dedup, `keepPreviousData`, and centralised
  session-expiry/conflict error handling. `fetchFresh` still bypasses the *HTTP*
  cache for the underlying GETs (cache-buster + `no-store`); React Query caches the
  *parsed result* in memory and refetches on invalidation. The two-phase load is two
  queries: `useBuildingsAndAgents` (map paints) → dependent `useEnergy`. Writes go
  through `useMutation` hooks (`src/hooks/mutations.ts`) that keep the existing
  service functions (incl. `readModifyWrite`'s ETag locking) as `mutationFn` and
  `invalidateQueries` on settle. `useSolidData()` survives as a thin RQ-backed
  selector returning the legacy shape. Two deliberate exceptions stay on their own
  state: **`ConnectPage`** (a self-contained single-room state machine, not a
  shared cached list) and the **org/logo** dialog+avatar (one-shot form prefill +
  object-URL lifecycle).
