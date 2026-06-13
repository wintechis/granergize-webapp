# Data dereferencing & lookups

How the app turns a logged-in WebID into in-memory buildings/agents/energy: which
resources it dereferences, in what order, and how references between resources are
resolved. Companion to [`data-layout.md`](./data-layout.md) (where things live on
the Pod) and [`data-schema.md`](./data-schema.md) (the shapes of what's fetched).

Line references drift — treat them as signposts, not coordinates.

## The model in one line

**Discover-then-bulk-fetch + in-memory join** — not Linked Data
*follow-your-nose* (dereference each IRI as you meet it) and not a SPARQL
endpoint. Discovery — a container listing plus the folded `shared-in/` log, not a
registry document — says *which* documents to fetch; the app fetches them
concurrently, parses each into a provenance-tagged graph, and resolves the
references between them in memory.

## The dereferencing primitive: `session.fetch`

Every read/write goes through the authenticated `fetch` from
`@inrupt/solid-client-authn-browser` — a drop-in `fetch` that attaches a
**DPoP-bound OAuth access token + a per-request DPoP proof**, so the Solid server
authorises against the user's WebID. Public resources work unauthenticated;
private ones need the token; cross-origin reads (a source on another Pod) also
need that server's CORS + ACL to permit you.

One thin wrapper sits on top: `fetchFresh(url, session)`
(`src/services/pod/podFetch.ts`) — sets `cache: "no-cache"` (revalidate), so
read-modify-write cycles see current state while a conditional `If-None-Match`
can still come back `304` with no body. There is **no `?t=` cache-buster**: the
URI stays stable so the HTTP cache / React Query can key on it.

All Pod requests are funnelled through `session.fetch`, wrapped once at login
(`instrumentSessionFetch`, `networkActivity.ts`) so every dereference shows up in
the header activity indicator.

## The discovery chain — *what to fetch*

Resolved once per session, then cached:

1. **WebID → storage root.** `resolveStorageRoot(session)`
   (`src/services/pod/solidUtils.ts`) GETs the WebID profile document, parses it
   with n3, and reads `<webId> pim:storage <root>`. Throws if absent — there is no
   WebID string-munge fallback. Cached so the many synchronous callers stay simple.
2. **Storage root → fixed paths.** `podResources(webId)` returns every app path as
   `<root>granergize/…` (layout owned by [`data-layout.md`](./data-layout.md)). One
   tree; no per-call base munging.
3. **Discover source URIs.** Own and shared buildings are discovered separately
   (`loadBuildingsAndAgents`, `src/services/TurtleParsingService.ts`):
   - *Own buildings* — `discoverOwnBuildings` **LISTS** the `buildings/` container
     and keeps the top-level `*.ttl` files (no registry: adding a building is a
     single PUT, so the listing can't desync). `listDirectChildren` returning `null`
     (404) means a *fresh* Pod vs `[]` for an *empty* one; demo buildings aren't
     auto-seeded — the UI *offers* them via a banner (`useDemoSeedPrompt` /
     `seedDemoBuildings`), so a fresh Pod loads empty until the user chooses.
   - *Shared buildings* — `listSharedBuildingSources` folds the `shared-in/` event
     log for `gran:kind rec:Building` grants (log owned by [`sharing.md`](./sharing.md)).
     **These URIs may live on other Pods.**
4. **Fetch each source.** `loadTtlFromMultipleSources` fetches all sources
   **concurrently** (`Promise.all`). Inaccessible sources (403/404) are tolerated
   and pruned (a 403/404 shared source is dropped from `shared-in/` so it self-heals
   next load; own buildings always load); an all-401 result throws
   `SessionExpiredError` (see Failure modes).

So "lookup" here means *list the `buildings/` container and fold the `shared-in/`
log* to discover the document set to dereference.

## Parsing each document into a graph

For every fetched Turtle file (`loadTtlFromMultipleSources`):

- Parse with `new Parser({ baseIRI: url })` — **relative IRIs resolve against the
  file's own URI**, the standard RDF dereference semantic.
- Rewrite each quad so its **named graph = the source URI** — provenance: which
  file each triple came from.
- **Scope blank nodes** by prefixing them with the source URI, so `_:obs0` from two
  different files can't collide once merged.
- Merge everything into one n3 `Store`.

The merged graph is then **projected into typed JS objects** (`BuildingType` etc.)
via the predicate→field maps in `buildingConfig.ts` — a one-way, load-time
translation after which components see no RDF. That mapping is documented in
[`data-schema.md` → "Two schemas: RDF graph ⇄ app objects"](./data-schema.md).

## Resolving references — *resolving an IRI to its data*

Once parsed, references between resources are resolved **in memory against the
merged graph — the app does not re-dereference each IRI it encounters**:

- `parseBuildings` (`src/services/rdf/building/buildingParser.ts`) walks the quads into a
  `Map<id, BuildingType>`. The **building id** comes from the subject IRI via
  `extractBuildingIdStrict` (the `#fragment`, or the `…/buildings/<id>` path
  segment). Blank-node sub-structures (energy datasets, operating costs,
  certifications, SOSA observations) are stitched back to their building through
  blank-node→building maps built during the walk.
- Cross-references such as `rec:operatedBy` / `schema:customer` are kept as IRIs and
  resolved against the in-memory **agents** map (rendered as in-app links); the app
  does *not* fetch each agent IRI on its own.
- **Energy** dispatches on the declared `cons:granularity` (an `xsd:duration`):
  date-part durations (`P1Y`, `P1M`, …) are **aggregates**, bulk-loaded with the
  building; time-only durations (`PT15M`, `PT1H`, …) are **time series**,
  **lazy-loaded on demand** (on building click) rather than eagerly dereferenced —
  see [`energy-model.md`](./energy-model.md).
- The UI exposes two ways to act on an IRI: `RefLink` (in-app router navigation,
  resolved against already-loaded data) and `UriLink` (opens the raw resource in a
  new tab — lets the browser dereference it). See
  `src/components/detail/DetailView.tsx`.

A two-phase load (`fetchAndParseData`'s `onBuildingsAndAgents` callback) hands
buildings + agents to the UI first, then streams energy in.

## Writes — dereference, then conditionally replace

Mutations use `readModifyWrite` (`src/services/pod/podWrite.ts`): GET (capturing
the `ETag`) → mutate the n3 Store → PUT guarded by `If-Match` (or `If-None-Match: *`
for a create), retrying on `412` — optimistic locking, so a concurrent writer can't
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
  IRIs on demand and could run SPARQL across the web of documents. Here the document
  set is discovered up front (container listing + folded log) and joins happen in JS.
- **Not a SPARQL endpoint.** Reads are whole-document GETs of Turtle files, parsed
  client-side.
- **HTTP cache is revalidated, and there is a client query cache.** The read path
  is wrapped in **TanStack React Query** (`src/hooks/queries.ts`, `QueryProvider`):
  caching, dedup, `keepPreviousData`, centralised session-expiry/conflict handling.
  `fetchFresh` revalidates the *HTTP* cache for the underlying GETs (`cache:
  "no-cache"`, so a `304` serves the stored body), keying on a stable URI; React
  Query caches the *parsed result* in memory and refetches on invalidation. The
  two-phase load is two queries: `useBuildingsAndAgents` (map paints) → dependent
  `useEnergy`. Writes go through `useMutation` hooks (`src/hooks/mutations.ts`) that
  reuse the service functions (incl. `readModifyWrite`'s ETag locking) as
  `mutationFn` and `invalidateQueries` on settle. `useSolidData()` survives as a
  thin RQ-backed selector returning the legacy shape. Two deliberate exceptions stay
  on their own state: **`ConnectPage`** (a self-contained single-room state machine,
  not a shared cached list) and the **org/logo** dialog+avatar (one-shot form
  prefill + object-URL lifecycle).
