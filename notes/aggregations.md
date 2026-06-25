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
owners — [`peer-benchmark.md`](./peer-benchmark.md) describes that round-trip and the
three comparison cases (portfolio / operator / BSP).

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
benchmark options. See [`peer-benchmark.md`](./peer-benchmark.md).

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
- **Finder** — `AggregationsFinder` lists the definitions (`useAggregationDefinitions`)
  with view / refresh / share / delete actions and a multi-select source-tier facet
  (`AGGREGATION_TIERS` = `mine` / `shared` / `open`): own definitions are `mine`,
  aggregations **shared with you** (received snapshots, `useSharedAggregations`) are
  `shared`, and public regional-statistics datasets are `open` (the open tier and the
  `mine`/`shared`/`open` ladder are owned by [`data-architecture.md`](./data-architecture.md)). It offers three
  URI-synced guises (`?guise=`): the **list** (default), a region **map** choropleth,
  and a cross-year **timeline** — the latter two keyed on the `spatialExtent` recorded
  above. (The Sharing finder itself is only a lean audit of incoming *building* grants —
  see [`sharing.md`](./sharing.md).)
- **Detail** — the standalone `/aggregation` route (the `Aggregation` page; the id rides
  in `?ref=` relative / `?uri=` absolute) loads the definition + snapshot and renders a
  bar chart + table. Being a full-page route outside the app shell, it keeps its own
  loading spinner (per the loading policy).
