# Aggregated views — definition, snapshot, sharing

An aggregated view is a saved aggregation (sum / average / min / max) over a set of
the user's own buildings for one or more metrics. It exists as **two resources**: a
private **definition** (which buildings, which metrics, how to aggregate) and a
**computed snapshot** (only the resulting numbers + a building count). The snapshot is
the privacy-preserving artefact that gets shared — recipients see aggregate values, not
the source buildings. Companion to [`energy-model.md`](./energy-model.md) (the energy
data being aggregated), [`sharing.md`](./sharing.md) (how the snapshot is shared), and
[`data-layout.md`](./data-layout.md) (where the resources sit). A snapshot additionally
typed as a benchmark result carries a peer benchmark back to contributing owners —
[`peer-benchmark.md`](./peer-benchmark.md) describes that round-trip and the three
comparison cases (portfolio / operator / BSP).

## Two resources

Both live under `granergize/views/` (container-native, discovered by listing — no
registry); the `<view-id>` slug is the opaque `view-<uuid>` form. The definition
is one resource per view; the snapshot is its computed copy under `snapshots/`.

### Definition — `views/<view-id>.ttl` (private)

Holds the inputs, including the source building URIs (so it stays private).

```turtle
@prefix cons: <https://solid.ti.rw.fau.de/gra/consumption.ttl#> .
@prefix xsd:  <http://www.w3.org/2001/XMLSchema#> .

<#view> a cons:AggregatedViewDefinition ;
   cons:viewId          "view-1717…-ab12" ;
   cons:viewName        "Portfolio electricity 2024" ;
   cons:aggregationType "average" ;                 # average | sum | min | max
   cons:createdAt       "2026-…"^^xsd:dateTime ;
   cons:lastComputedAt  "2026-…"^^xsd:dateTime ;    # optional
   cons:viewPeriod      "2024-03" ;                 # optional, "YYYY-MM" (user monthly)
   cons:benchmark       true ;                      # optional — see Benchmark flag below
   cons:includesBuilding <…/buildings/b-1.ttl#b-1> ,
                         <…/buildings/b-2.ttl#b-2> ; # the private inputs
   cons:includesMetric  "electricity" , "gas" .
```

### Snapshot — `views/snapshots/<view-id>.ttl` (shareable)

The computed copy. **No `cons:includesBuilding` triples** — only the count and the
per-metric aggregate values, so a recipient can't infer individual buildings.

```turtle
<#snapshot> a cons:AggregatedViewSnapshot ;
   cons:viewId          "view-1717…-ab12" ;
   cons:viewName        "Portfolio electricity 2024" ;
   cons:aggregationType "average" ;
   cons:computedAt      "2026-…"^^xsd:dateTime ;
   cons:buildingCount   5 ;                          # how many buildings, not which
   cons:includesMetric  "electricity" , "gas" ;
   cons:electricityValue "1234.56"^^xsd:decimal ;    # one <metric>Value per metric
   cons:gasValue         "567.89"^^xsd:decimal .
```

## Computation

Computing a snapshot loads each building's energy and reduces it across the set with the
chosen `aggregationType`. Two paths, by the definition's shape:

- **Annual** (no `viewPeriod`) — `loadBuildingEnergyData` fetches each building's latest
  *actual* annual `cons:EnergyDataset` (the non-series one) and reads the requested
  metrics. This is the investor / benchmark case.
- **Monthly** (`viewPeriod` set) — `loadUserBuildingMonthlyTotal` sums a building's
  `PT15M` series readings for that `YYYY-MM`. This is the user (load-profile) case;
  metrics reduce to `electricity`.

Snapshots are computed **explicitly**, not reactively: on create (`computeAndStoreSnapshot`
right after `createViewDefinition`), on a manual refresh (`refreshSnapshot`), which
also bumps the definition's `cons:lastComputedAt`, and once on first open of the view
page when no snapshot exists yet. The auto-compute keys on genuine absence:
`loadComputedSnapshot` returns `null` only for a 404 and **throws** on transient
failures, so a throttled read of an existing snapshot can never trigger an overwriting
recompute. Underlying building edits do **not** auto-recompute — the snapshot is a
point-in-time capture. All buildings in a view must be on the owner's own Pod (no
cross-Pod aggregation).

**Benchmark flag.** A benchmark view records `cons:benchmark true` **on the
definition** — the same record-the-dimension-at-the-source principle as the sharing
log. Every compute derives the snapshot's `cons:BenchmarkResult` typing (plus
`computedBy` and a `metricPeriod` derived from the years actually aggregated) from
that persisted flag, so a plain refresh cannot strip the benchmark typing; there are
no call-site benchmark options. See [`peer-benchmark.md`](./peer-benchmark.md).

## Sharing the snapshot

View sharing is the building-sharing flow applied to the **snapshot only** (see
[`sharing.md`](./sharing.md) for the event-log mechanics):

- **Share** — `shareAggregatedView(snapshotUrl, webId, session)` grants `acl:Read` on
  the snapshot resource, POSTs a grant event to the recipient's inbox, and records it in
  `shared-out/`. The event carries `cons:kind cons:View` (the routing hint that tells the
  recipient to load it as a view, not a building). The `view-id` is recoverable from the
  snapshot URI, so it isn't stored on the event.
- **Receive** — `getReceivedViews` folds `shared-in/` for `cons:View` grants; the
  recipient has only the snapshot + its Read grant (never the definition), rendered via
  `loadComputedSnapshot`.
- **Revoke** — `revokeViewAccess` logs a revocation, withdraws the snapshot `.acl`, and
  notifies the recipient. Deleting a view first runs `revokeAllViewRecipients` so the
  snapshot doesn't linger on anyone's "shared with you" list, then `deleteView` removes
  the definition, the snapshot, and their `.acl`s.

## UI

- **Create** — `CreateViewDialog`: pick buildings (filtered by the producing category
  derived from their provenance), the metrics for that category, the aggregation type,
  and — for the user/monthly case — a month (its picker lists each building's series
  container to find available months). Create then computes the first snapshot.
- **Manage** — `ManagePage` lists the definitions (`useViewDefinitions`) with
  view / refresh / share / delete actions and a "shared with" sub-list.
- **Detail** — the standalone `/view/:viewId` route (`AggregatedView`) loads the
  definition + snapshot and renders a bar chart + table. Being a full-page route outside
  the app shell, it keeps its own loading spinner (per the loading policy).
- **Received** — the Share tab (`SharePage`) lists views shared with you and renders
  each fetched snapshot.
