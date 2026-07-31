# Aggregations — definition, snapshot, sharing

An aggregation is a saved roll-up (sum / average / min / max) over a set of buildings
for one or more metrics. It exists as **two resources**: a private **definition**
(which buildings, which metrics, how to aggregate) and a **computed snapshot** (only the
resulting numbers + a building count). The snapshot is the privacy-preserving artefact
that gets shared — recipients see aggregate values, not the source buildings. Companion
to [`energy-model.md`](./energy-model.md) (the energy data being aggregated),
[`sharing.md`](./sharing.md) (how the snapshot is shared), and
[`storage-layout.md`](./storage-layout.md) (where the resources sit). A snapshot
additionally typed as a benchmark result carries a peer benchmark back to contributing
owners — see *Peer benchmark* below for that round-trip and the three comparison cases
(portfolio / operator / BSP).

## Two resources

Both live under `granergize/aggregations/` (container-native, discovered by listing — no
registry); the `<aggregation-id>` slug is the opaque `aggregation-<uuid>` form. The
definition is one resource per aggregation; the snapshot is its computed copy under
`snapshots/`.

### Definition — `aggregations/<aggregation-id>.ttl` (private)

Holds the inputs, including the source building URIs (so it stays private).

```turtle
@prefix cons: <https://solid.ti.rw.fau.de/gra/consumption.ttl#> .
@prefix xsd:  <http://www.w3.org/2001/XMLSchema#> .

<#aggregation> a cons:AggregationDefinition ;
   cons:aggregationId     "aggregation-1717…-ab12" ;
   cons:aggregationName   "Portfolio electricity 2024" ;
   cons:aggregationType   "average" ;                 # average | sum | min | max
   cons:createdAt         "2026-…"^^xsd:dateTime ;
   cons:lastComputedAt    "2026-…"^^xsd:dateTime ;    # optional
   cons:aggregationPeriod "2024-03" ;                 # optional, "YYYY-MM" (user monthly)
   cons:benchmark         true ;                      # optional — see Benchmark flag below
   cons:includesBuilding  <…/buildings/b-1.ttl#b-1> ,
                          <…/buildings/b-2.ttl#b-2> ;  # the private inputs
   cons:includesMetric    "electricityConsumption" , "heatConsumption" ;
   cons:spatialExtent     <…region IRI…> ;            # optional — see Spatial extent below
   cons:extentLevel       "LAU" .                     # optional
```

### Snapshot — `aggregations/snapshots/<aggregation-id>.ttl` (shareable)

The computed copy. **No `cons:includesBuilding` triples** — only the count and the
per-metric aggregate values, so a recipient can't infer individual buildings. The node
is both a `cons:AggregationSnapshot` (the app marker) and a `sosa:ObservationCollection`:
each metric is a member `sosa:Observation`, the same shape an energy dataset uses
(`energyDataset.ts`), so one renderer serves energy, aggregation and benchmark alike.
Values are stored at full precision; display rounding is the UI's job.

```turtle
@prefix cons: <https://solid.ti.rw.fau.de/gra/consumption.ttl#> .
@prefix sosa: <http://www.w3.org/ns/sosa/> .
@prefix ssn:  <http://www.w3.org/ns/ssn/> .
@prefix unit: <https://qudt.org/vocab/unit#> .
@prefix xsd:  <http://www.w3.org/2001/XMLSchema#> .

<#snapshot> a cons:AggregationSnapshot , sosa:ObservationCollection ;
   cons:aggregationId   "aggregation-1717…-ab12" ;
   cons:aggregationName "Portfolio electricity 2024" ;
   cons:aggregationType "average" ;
   cons:computedAt      "2026-…"^^xsd:dateTime ;
   cons:buildingCount   5 ;                            # how many buildings, not which
   cons:includesMetric  "electricityConsumption" , "heatConsumption" ;
   sosa:hasMember [ a sosa:Observation ;
        sosa:observedProperty cons:ElectricityConsumption ;
        sosa:hasResult [ sosa:hasSimpleResult "1234.56"^^xsd:decimal ;
                         ssn:hasUnit unit:KiloW-HR ] ] ,
                    [ a sosa:Observation ;
        sosa:observedProperty cons:HeatConsumption ;
        sosa:hasResult [ sosa:hasSimpleResult "567.89"^^xsd:decimal ;
                         ssn:hasUnit unit:KiloW-HR ] ] .
```

Only metrics with a known `sosa:observedProperty` + unit (`metricInfo`, sourced from
`ENERGY_METRICS`) become members; a metric without one is simply absent from the
collection.

## Computation

Computing a snapshot loads each building's energy and reduces it across the set with the
chosen `aggregationType`. Two paths, by the definition's shape:

- **Annual** (no period) — `loadBuildingEnergyData` fetches each building's latest
  *actual* annual `cons:EnergyDataset` (the non-series one) and reads the requested
  metrics. This is the investor / benchmark case.
- **Monthly** (`aggregationPeriod` set) — `loadUserBuildingMonthlyTotal` sums a
  building's `PT15M` series readings for that `YYYY-MM`. This is the user (load-profile)
  case; metrics reduce to `electricity`.

Snapshots are computed **explicitly**, not reactively: on create
(`computeAndStoreSnapshot` right after `createAggregationDefinition`), on a manual
refresh (`refreshSnapshot`), which also bumps the definition's `cons:lastComputedAt`,
and once on first open of the aggregation page when no snapshot exists yet. The
auto-compute keys on genuine absence: `loadComputedSnapshot` returns `null` only for a
404 and **throws** on transient failures, so a throttled read of an existing snapshot
can never trigger an overwriting recompute. Underlying building edits do **not**
auto-recompute — the snapshot is a point-in-time capture. All buildings in an
aggregation must be on the owner's own Pod (no cross-Pod aggregation).

**Benchmark flag.** A benchmark aggregation records `cons:benchmark true` **on the
definition** — the same record-the-dimension-at-the-source principle as the sharing log.
Every compute derives the snapshot's `cons:BenchmarkResult` typing (plus `cons:computedBy`
and a `cons:metricPeriod` derived from the years actually aggregated) from that persisted
flag, so a plain refresh cannot strip the benchmark typing; there are no call-site
benchmark options. See *Peer benchmark* below.

**Spatial extent.** When a definition's member set rolls up to a single region, the
aggregation records that region as `cons:spatialExtent` (the region IRI) plus a
`cons:extentLevel` (e.g. `LAU`), on both the definition and — so a shared copy stays
self-sufficient — the snapshot. This is distinct from the private `includesBuilding` set
and is the load-bearing axis for the finder's map and timeline guises (below).

## Sharing the snapshot

Aggregation sharing is the building-sharing flow applied to the **snapshot only** (see
[`sharing.md`](./sharing.md) for the event-log mechanics):

- **Share** — `shareAggregation(snapshotUri, webId, gateway)` grants `acl:Read` on the
  snapshot resource, POSTs a grant event to the recipient's inbox, and records it in
  `shared-out/`. The event carries `gran:kind cons:Aggregation` (the routing hint that
  tells the recipient to load it as an aggregation, not a building). The aggregation id
  is recoverable from the snapshot URI, so it isn't stored on the event.
- **Receive** — `getReceivedAggregations` folds `shared-in/` for `cons:Aggregation`
  grants; the recipient has only the snapshot + its Read grant (never the definition),
  rendered via `loadComputedSnapshot`.
- **Revoke** — `revokeAggregationAccess` logs a revocation, withdraws the snapshot
  `.acl`, and notifies the recipient. Deleting an aggregation first runs
  `revokeAllAggregationRecipients` so the snapshot doesn't linger on anyone's "shared
  with you" list, then `deleteAggregation` removes the definition, the snapshot, and
  their `.acl`s.

## UI

- **Create** — `CreateAggregationDialog`: pick buildings (filtered by the energy shape
  present), the metrics for that shape, the aggregation type, and — for the user/monthly
  case — a month (its picker lists each building's series container to find available
  months). Create then computes the first snapshot.
- **Collection** — `AggregationsPanel` lists the definitions (`useAggregationDefinitions`)
  with view / refresh / share / delete actions and a multi-select source-tier facet
  (`AGGREGATION_TIERS` = `mine` / `shared` / `open`): own definitions are `mine`,
  aggregations **shared with you** (received snapshots, `useSharedAggregations`) are
  `shared`, and public regional-statistics datasets are `open` (the open tier and the
  `mine`/`shared`/`open` ladder are owned by [`data-architecture.md`](./data-architecture.md)). It offers three
  URI-synced guises (`?guise=`): the **list** (default), a region **map** choropleth,
  and a cross-year **timeline** — the latter two keyed on the `spatialExtent` recorded
  above. (The Sharing finder itself is only a lean audit of incoming *building* grants —
  see [`sharing.md`](./sharing.md).) The panel is **not its own route** any more: Step 2
  of [`plan-cube-centered-ui.md`](../plans/plan-cube-centered-ui.md) folded it into
  **Explore** as the saved-views projection (`/explore?view=aggregations`) — an
  aggregation IS a saved cube coordinate + roll-up spec — with `/aggregations` kept as a
  redirect (see [`ui-state.md`](./ui-state.md)).
- **Materialized cells** — a snapshot is also a *cell* of the same cube, so Explore's
  pivot renders the readable snapshots (own + received, benchmarks included) as a
  trailing "computed figures" section beside the live rows: shaped by
  `services/cube/snapshotCells.ts`, placed at the year its `metricPeriod` (or the
  definition's monthly `period`) covers, labelled with the Ø's member count and — for a
  benchmark — its `computedBy` producer. Labelled cells only: no drill (a snapshot hides
  its members), no banding, and never part of the live rows' peer sets.
- **Detail** — the standalone `/aggregation` route (the `Aggregation` page; the id rides
  in `?ref=` relative / `?uri=` absolute) loads the definition + snapshot and renders a
  bar chart + table. Being a full-page route outside the app shell, it keeps its own
  loading spinner (per the loading policy).

## Peer benchmark (BSP round-trip)

A benchmark is an aggregation snapshot computed by a **Benchmark Service Provider (BSP)** —
not a server but another Solid user running the same app in a provider capacity — over the
buildings other owners shared *to* it, and shared back so each contributor compares against
a *real* peer mean instead of a self-referential local one. (A domain benchmark of energy
consumption, not a software one.) It reuses the aggregation + sharing machinery unchanged,
inheriting the privacy property a benchmark needs: only the snapshot (values + count)
travels; the definition (the contributing building IRIs) stays private to the BSP.

**Three comparison cases.** The annual energy table shows up to three peer means side by
side — one idea ("how does my building sit against a peer mean?") varied by *who already
holds the peer data*, which dictates how much sharing it needs:

- **Portfolio average** — peers are the user's *own* buildings; already on their Pod, no
  sharing. Computed in the energy fold.
- **Operator average** (Betreiber-Durchschnitt) — peers are one *operator's* buildings,
  grouped by the `operatedBy` link. The single-Pod form (the user's own buildings grouped
  by operator, each contributing its latest actual annual year) is the energy fold; the
  cross-owner form (the operator computes and shares back) is the BSP round-trip with its
  first movement already satisfied — the operator already holds the numbers.
- **BSP benchmark** — peers span *other owners'* portfolios and the aggregating agent
  starts with nothing: the full four-movement round-trip.

They line up by how far outside the user's own data the peer set reaches; each row is
populated independently (all that apply are shown, never collapsed into one preferred
figure), the benchmark cell taking the value from the newest received snapshot that carries
the metric (`pickBenchmark`) — only the four annual-consumption metrics can carry one, so
the rest show an em-dash.

**The round-trip** — four movements, each resting on existing machinery:

1. An owner shares a building (energy included, optionally scoped to years) with the BSP's
   WebID — the ordinary building share, the BSP simply a recipient.
2. The BSP computes the benchmark: its create-aggregation flow sources candidates from the
   *shared-with-me* fold (not owned buildings — received buildings carry the sharer's
   provenance), averages the annual electricity/heat/water/wastewater metrics, and persists
   a snapshot typed as a benchmark result recording the computing agent and the period.
3. The BSP shares the snapshot back to every contributor in one fan-out (the
   aggregation-share path: grant + inbox event + `shared-out/` append under
   `cons:Aggregation`).
4. The owner consumes it: the annual table adds a benchmark row beside its own per-year
   (Ist) figures, the computing BSP surfaced as an agent reference.

**Boundary & vocabulary.** The benchmark exposes only aggregate values and a contributor
count, so no source building is reconstructable — the same definition/snapshot split the
feature enforces, preserved. The snapshot self-describes as a benchmark (an owned
`cons:BenchmarkResult` class — a specialisation of the snapshot — plus `cons:computedBy`
and `cons:metricPeriod`), versioned and conformance-tested with the code. Replay of the
sharing log stays same-Pod. Verified at the integration tier (two owners share, the BSP
computes and shares back, an owner reads the averages) and as its own browser benchmarking
spec; `summarizeContributors` and `pickBenchmark` carry offline-fixture unit tests.
