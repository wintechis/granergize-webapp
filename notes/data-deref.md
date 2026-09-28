# Data dereferencing & lookups

How the app turns a logged-in WebID into in-memory buildings/agents/energy: which
resources it dereferences, in what order, and how references between resources are
resolved. Companion to [`storage-layout.md`](./storage-layout.md) (where things live on
the Pod) and [`data-schema.md`](./data-schema.md) (the shapes of what's fetched).

Line references drift — treat them as signposts, not coordinates.

## The model in one line

**Discover-then-bulk-fetch + in-memory join** — not Linked Data
*follow-your-nose* (dereference each IRI as you meet it) and not a SPARQL
endpoint. Discovery — a container listing plus the folded `shared-in/` log, not a
registry document — says *which* documents to fetch; the app fetches them
concurrently, parses each into a provenance-tagged graph, and resolves the
references between them in memory.

## The dereferencing primitive: the authed `fetch`

Every read/write goes through the authenticated `fetch` from
`@inrupt/solid-client-authn-browser` — a drop-in `fetch` that attaches a
**DPoP-bound OAuth access token + a per-request DPoP proof**, so the Solid server
authorises against the user's WebID. Public resources work unauthenticated;
private ones need the token; cross-origin reads (a source on another Pod) also
need that server's CORS + ACL to permit you. The data layer never touches the inrupt
session object directly — it receives a flat `PodGateway` (`{ fetch, webId }`, the
session's authed `fetch` plus the WebID) and calls `gateway.fetch`.

One thin wrapper sits on top: `fetchFresh(uri, gateway)`
(`src/services/pod/podFetch.ts`) — sets `cache: "no-cache"` (revalidate), so
read-modify-write cycles see current state while a conditional `If-None-Match`
can still come back `304` with no body. There is **no `?t=` cache-buster**: the
URI stays stable so the HTTP cache / React Query can key on it.

All Pod requests are funnelled through this authed `fetch`, wrapped once at login
(`instrumentSessionFetch`, `networkActivity.ts`) so every dereference shows up in
the header activity indicator.

## The discovery chain — *what to fetch*

Resolved once per session, then cached:

1. **WebID → storage root.** `resolveStorageRoot(gateway)`
   (`src/services/pod/solidUtils.ts`) GETs the WebID profile document, parses it
   with n3, and reads `<webId> pim:storage <root>`. Throws if absent — there is no
   WebID string-munge fallback. Cached so the many synchronous callers stay simple.
2. **Storage root → fixed paths.** `podResources(webId)` returns every app path as
   `<root>granergize/…` (layout owned by [`storage-layout.md`](./storage-layout.md)). One
   tree; no per-call base munging.
3. **Discover source URIs.** Own and shared buildings are discovered separately
   (`loadBuildings` / `fetchAndParseData`, `src/services/turtleParsing.ts`):
   - *Own buildings* — `listOwnBuildings` **LISTS** the `buildings/` container
     and keeps the top-level `*.ttl` files (no registry: adding a building is a
     single PUT, so the listing can't desync). `listDirectChildren` returning `null`
     (404) means a *fresh* Pod vs `[]` for an *empty* one; example buildings aren't
     seeded — they arrive through the ordinary file import ("Autofill from file" →
     "Try an example file"), so a fresh Pod loads empty until the user imports.
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

- Parse with `new Parser({ baseIRI: uri })` — **relative IRIs resolve against the
  file's own URI**, the standard RDF dereference semantic.
- Rewrite each quad so its **named graph = the source URI** — provenance: which
  file each triple came from.
- **Scope blank nodes** by prefixing them with the source URI, so `_:obs0` from two
  different files can't collide once merged.
- Merge everything into one n3 `Store`.

The merged graph is then **projected into typed JS objects** (`Building` etc.)
via the predicate→field maps in `buildingConfig.ts` — a one-way, load-time
translation after which components see no RDF. That mapping is documented in
[`data-schema.md` → "Two schemas: RDF graph ⇄ app objects"](./data-schema.md).

## Resolving references — *resolving an IRI to its data*

Once parsed, references between resources are resolved **in memory against the
merged graph — the app does not re-dereference each IRI it encounters**:

- `parseBuildings` (`src/services/rdf/building/buildingParser.ts`) walks the quads into a
  `Map<id, Building>`. The **building id** comes from the subject IRI via
  `buildingIdFor` (`buildingId.ts` — the `#fragment`, or the `…/buildings/<id>` path
  segment). Blank-node sub-structures (energy datasets, operating costs,
  certifications, SOSA observations) are stitched back to their building through
  blank-node→building maps built during the walk.
- Cross-references to agents — `rec:operatedBy` / `rec:ownedBy` / `bldg:investor` /
  `schema:customer` and the producer `attributedTo` — are kept as **opaque IRIs**; the
  bulk load does *not* fetch them, and agent *names* no longer come from the merged
  graph (the legacy agents source was removed — see
  [`building-detail.md`](./building-detail.md) §3a). A name/avatar is resolved **on demand**
  by `resolveAgent` / `resolveAgentOrg` (`agents/agentResolver.ts`, behind
  `useResolveAgent` / `useResolveOrg`): it dereferences the agent's **own document** —
  the IRI minus its `#fragment` (`profileDocUri`) — via `fetchFresh`, reads
  `foaf:name` / `vcard:fn` (+ `foaf:img` / `vcard:hasPhoto`; `org:memberOf` → org
  name/logo), caches per **target** doc-URI, and **never throws** — an
  unreadable/offline/non-RDF document yields the IRI **fragment** as the label
  (`webIdFragment`), never text derived from the IRI's structure. This is the one lazy,
  per-agent dereference the app makes — a narrow exception to discover-then-bulk-fetch
  (§ What this is NOT).
- **Energy** dispatches on the declared `cons:granularity` (an `xsd:duration`):
  date-part durations (`P1Y`, `P1M`, …) are **aggregates**, bulk-loaded with the
  building; time-only durations (`PT15M`, `PT1H`, …) are **time series**,
  **lazy-loaded on demand** (on building click) rather than eagerly dereferenced —
  see [`energy-model.md`](./energy-model.md).
- The UI exposes two ways to act on an IRI: `RefLink` (in-app router navigation,
  resolved against already-loaded data) and `UriLink` (opens the raw resource in a
  new tab — lets the browser dereference it). See
  `src/components/detail/DetailView.tsx`.

**External (non-Pod) agent IRIs** are managed the same way — e.g. an operator
`https://wunderfacts.com/mastr/abr/937743848821#it`: the app fetches the document
`https://wunderfacts.com/mastr/abr/937743848821` and reads its `foaf:name`. But this is
a real cross-origin browser request, so a name comes back only if the host serves
RDF/Turtle **and** sends permissive CORS — a Solid WebID profile does; a no-CORS Linked
Data source such as wunderfacts does not, so the label falls back to the fragment
(`it`). A `foaf:name` the *producer inlined* in the building file is not consulted —
`resolveAgent` reads the agent's own document, not the merged graph. The raw external
document stays reachable via `UriLink` / the dev-mode source link, which opens it in a
new tab, a top-level navigation CORS does not gate.

**Local annotations override the resolved profile.** An agent's own document is
read-only — it lives on its Pod or a wrapper, not ours. The user can still curate a
referenced agent: the address book (`agents.ttl`, `savedAgents.ts`) holds a **local
record keyed by the agent IRI** — a person's stored name and an optional "works for"
edge (`org:memberOf` to an org agent), or an organisation's name, homepage
(`vcard:hasURL`), cross-reference (`owl:sameAs`) and logo (`vcard:logo`). Resolution is
**local-record-wins**: the agent detail page (`/agent?uri=`, `AgentHeader`) prefers the
saved record over `resolveAgent`/`resolveAgentOrg`, and `AgentProfileSection` drops the
canonical organisation row when a local "works for" edge exists, so an affiliation shows
once. `resolveAgent` also classifies the agent as **person vs organisation**
(`ResolvedAgent.kind`): a standard `rdf:type` (`foaf:Person`/`vcard:Individual` vs
`…Organization`) first, else the MaStR shape (`mastr:Personenart` "Juristische" →
organisation / "Natuerliche" → person, else a `vocab:Operator`/`:MarketActor` type →
organisation), else a `foaf:logo` heuristic; with no signal the caller defaults to a
person, correctable in the editor (a local `kind` overrides the resolved one). A
Wikidata entity IRI is resolved too — via a plain fetch of its `Special:EntityData/Q….ttl`
(CORS-open), reading `rdfs:label`/`schema:name` + `wdt:P154` logo.

A two-phase load (`fetchAndParseData`'s `onBuildings` callback) hands buildings to
the UI first, then streams energy in.

## External wrapper endpoints

Beyond the Pod, the app reads **queried external sources** — third-party
Linked Data wrappers and a geocoder — over plain (non-Solid, non-DPoP) HTTP through
`trackedFetch` (`networkActivity.ts`: records the request in the activity indicator
**and** retries transient throttling), never the authed session. They are
**CORS-enabled, so fetched directly** (no dev proxy); each base is an env var only so it
stays overridable. The three below are reached on the normal load/edit path; the full
roster of `open`-tier public sources (LoD2 rooftop-PV, MaStR, netztransparenz,
Energie-Atlas, NUTS/LAU) and how they surface is owned by
[`data-architecture.md`](./data-architecture.md):

- **`linked-wetterdienst`** — weather (SOSA/QUDT). `VITE_WETTERDIENST_API_URI`, default
  `https://wunderfacts.com/wetterdienst/`. Dereferenced as Turtle by
  `linkedWeather.ts` (see [`weather.md`](./weather.md)).
- **`linked-regionalstatistik`** — regional statistics (RDF Data Cube).
  `VITE_REGIONALSTATISTIK_API_URI`, default
  `https://wunderfacts.com/regionalstatistik/`. Dereferenced as Turtle by
  `regionalCube.ts`.
- **Nominatim** — geocoding (JSON, not RDF), hard-coded
  `https://nominatim.openstreetmap.org/search` in `geocode.ts` (no env var; a
  custom-labelled `trackedFetch`).

Each wrapper client reads its base lazily and parses the response pure
(`parseRdfText` → typed objects), so the parser half is unit-testable offline.
These wrappers (and the `open`-tier ones in [`data-architecture.md`](./data-architecture.md)) are all
siblings of the `linked-*` family (`~/projects/linked-*`); the weather one is documented
end-to-end in `~/projects/linked-wetterdienst`.

The env-var base is also the **hermetic-e2e switch**: an `e2e:local` build can point
`VITE_*_API_URI` at a local fixture host (or a spec can `page.route` the wrapper URI)
so a test never depends on the live external service — see
[`../test/README.md`](../test/README.md) §External queried sources.

## Writes — dereference, then conditionally replace

Mutations use `readModifyWrite` (`src/services/pod/podWrite.ts`): GET (capturing
the `ETag`) → mutate the n3 Store → PUT guarded by `If-Match` (or `If-None-Match: *`
for a create), retrying on `412` — optimistic locking, so a concurrent writer can't
be silently clobbered. The data-room event log is the exception: it appends with
LDP `POST` to a container (race-free by construction) instead of rewriting a file.

**Write authority decides where org edits land.** Editing an organisation routes by
who owns the document, not by data shape (the fields are identical either way). The
user's **own** organisation is a `<#org>` node *inside their own WebID profile*, so
`organisation` edits it in place — they hold `acl:Write` on it. A **referenced**
organisation's authoritative document is on its Pod / a wrapper, where the user has no
write access; the same fields are therefore stored as the local record in `agents.ttl`
(`SaveAgent`) — an annotation on the user's own Pod, not a write to the agent's. One
shared editor (`components/agent/OrgDetail.tsx`), two save paths. The logo follows the
document it belongs to: the own-org logo is `foaf:logo` → `profile/logo.<ext>` (profile
data); a referenced-org logo is `vcard:logo` → `<appRoot>agents/logos/<stem>.<ext>`.
Both are published world-readable via the shared `logoImage.uploadPublicLogo` (image
`PUT` + a public-read `.acl`), since markers and the agent page load them with plain,
unauthenticated `<img>` requests.

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
  two-phase load is two `useQueries` fan-outs: `useBuildings` (one `buildingSource` query
  per source, map paints) → dependent `useEnergy` (one `buildingEnergy` query per
  building). Writes go through `useMutation` hooks (`src/hooks/mutations.ts`) that
  reuse the service functions (incl. `readModifyWrite`'s ETag locking) as
  `mutationFn` and `invalidateQueries` on settle. `useSolidData()` survives as a
  thin RQ-backed selector composing the two. Two deliberate exceptions stay on their
  own state: the **rooms registry** (`useRooms`, `staleTime: Infinity` + optimistic
  patches from the room mutations — not a shared cached list, so a background refetch
  can't revert an in-flight room switch) and the **org/logo** dialog+avatar (one-shot
  form prefill + object-URL lifecycle).
