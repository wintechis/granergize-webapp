# Energy model — one `cons:EnergyDataset` per (building, year, granularity)

Every energy reading is a `cons:EnergyDataset` that declares its own granularity,
period, and scenario; a building references each via a single `cons:hasEnergyDataset`
predicate. Datasets are **first-class, time-first** resources under
`granergize/observations/` (Phase-0 contract C2, `observationPath.ts`) — not nested in
the building's subtree — so an observation can also stand alone, linked to no building.
This is the *representation* counterpart to behaviour already dispatching on declared
granularity rather than role (see [`data-schema.md`](./data-schema.md)); where these
resources sit on the Pod is owned by [`storage-layout.md`](./storage-layout.md).

The unified shape replaces what used to be three linking predicates
(`investor:hasInvestorAnnualData`, `cons:hasEnergyConsumptionDataset`,
`cons:hasEnergyMeasurementData`), two layouts (inline vs located), and two metric
vocabularies (`investor:Annual…` vs `cons:…`). With one abstraction —
"a building has an energy dataset for year Y at granularity G" — adding, editing, and
sharing a single year all fall out uniformly, and there is one entry form regardless of
who produced the data.

## Principles

- **One link, one shape.** A building references each dataset with `cons:hasEnergyDataset`;
  every dataset is a `cons:EnergyDataset` declaring its granularity, period, and scenario.
- **Dispatch on declared shape, never role.** The data is uniform, so the parser keys on
  one predicate and the loader on the declared period.
- **A dataset is addressable and time-first.** Each dataset is its own resource (or
  container, for series) under `observations/{year}/…`, so it can be added, edited, and
  shared independently, and a reading bound to no building still has a home.
- **Observations stay SOSA.** The reading shape is unchanged (`sosa:Observation` +
  `sosa:hasResult` + `sosa:phenomenonTime`); only the grouping and metric IRIs unify.
- **Granularity is a duration literal,** not a minted class: `"P1Y"`, `"P1M"`, `"PT15M"`.
  The value sorts every dataset into one of two kinds (`isSeriesGranularity`,
  `durationUtils.ts`): a duration with a **date part** (`P1Y`, `P1M`, `P1W`, …) is an
  **aggregate** — small, bulk-loaded with the building; a **time-only** duration
  (`PT15M`, `PT1H`, …) is a **time series** — large, located in a container of daily
  files and lazy-loaded on demand. Any cadence is model-legal, but the write paths
  currently mint only the two ends: annual aggregates (`P1Y`, the year form's metric
  figures) and 15-minute series (`PT15M`, the Lastgang upload).

## The unified dataset

Metric IRIs unify under `cons:` (no producer split, no "Annual" prefix — the period
is declared separately): `cons:ElectricityConsumption`, `cons:HeatConsumption`,
`cons:WaterConsumption`, `cons:WastewaterConsumption`, `cons:RenewableSelfGeneratedShare`,
`cons:ElectricityGeneration`.

### Annual aggregate (small → inline in its own dataset resource)

```turtle
# …/granergize/observations/2024/<id>.ttl   ({id} = a UUID stem; #ds is the node)
@prefix cons: <https://solid.ti.rw.fau.de/gra/consumption.ttl#> .
@prefix sosa: <http://www.w3.org/ns/sosa/> .
@prefix ssn:  <http://www.w3.org/ns/ssn/> .
@prefix time: <http://www.w3.org/2006/time#> .
@prefix unit: <https://qudt.org/vocab/unit#> .
@prefix xsd:  <http://www.w3.org/2001/XMLSchema#> .

<#ds> a cons:EnergyDataset , sosa:ObservationCollection ;
   cons:ofBuilding  <../../buildings/<bid>.ttl#it> ;   # absent ⇒ a building-less reading
   cons:granularity "P1Y" ;
   cons:scenario    cons:Actual ;                 # or cons:Planned (Soll-Ist)
   sosa:phenomenonTime [ a time:Interval ;
        time:hasBeginning "2024-01-01"^^xsd:date ;
        time:hasEnd       "2024-12-31"^^xsd:date ] ;
   sosa:hasMember
      [ a sosa:Observation ; sosa:observedProperty cons:ElectricityConsumption ;
        sosa:hasResult [ sosa:hasSimpleResult "121500"^^xsd:decimal ;
                         ssn:hasUnit unit:KiloW-HR ] ] ,
      [ a sosa:Observation ; sosa:observedProperty cons:HeatConsumption ;
        sosa:hasResult [ sosa:hasSimpleResult "232000"^^xsd:decimal ;
                         ssn:hasUnit unit:KiloW-HR ] ] ,
      [ a sosa:Observation ; sosa:observedProperty cons:WaterConsumption ;
        sosa:hasResult [ sosa:hasSimpleResult "1500"^^xsd:decimal ;
                         ssn:hasUnit unit:M3 ] ] .
```

### Time series (sub-hourly; large → a located tree of daily reading files)

```turtle
# in …/granergize/observations/2024/<id>.ttl (the dataset descriptor)
<#ds> a cons:EnergyDataset ;
   cons:ofBuilding     <../../buildings/<bid>.ttl#it> ;
   cons:granularity    "PT15M" ;
   cons:scenario       cons:Actual ;
   sosa:phenomenonTime [ a time:Interval ;
        time:hasBeginning "2024-01-01"^^xsd:date ;
        time:hasEnd       "2024-12-31"^^xsd:date ] ;
   cons:datasetLocation <./> .                    # the period container holding the daily files
```

Each daily file is `observations/{year}/{month}/{day}/<id>.ttl` — the **same `{id}`** as
the descriptor, one calendar level deeper — and holds the readings (`sosa:Observation`
per 15-min slot). Unlike the aggregates, the series is never bulk-loaded: the
descriptor's time-only `cons:granularity "PT15M"` marks it lazy, and the daily files are
fetched only when the user opens that building's series chart.

### The building link (one predicate)

```turtle
# in …/granergize/buildings/<bid>.ttl
<#it> cons:hasEnergyDataset <../observations/2024/<id-a>.ttl#ds> ,
                            <../observations/2023/<id-b>.ttl#ds> ,
                            <../observations/2024/<id-c>.ttl#ds> .   # the PT15M series descriptor
```

The link is the **discovery path**: a building's datasets are found by reading its
`cons:hasEnergyDataset` links, not by listing a per-building energy folder. An
observation with no `cons:ofBuilding` (and that no building links) is a building-less
reading, discovered by listing `observations/` directly.

## Resource layout

```
buildings/<bid>.ttl                      building master data (+ cons:hasEnergyDataset links)
observations/                            first-class, time-first (Phase-0 C2)
    2024/<id-a>.ttl                      annual aggregate (inline observations)
    2023/<id-b>.ttl
    2024/<id-p>.ttl                      Soll: a cons:Planned dataset for the same year (own {id})
    2024/<id-c>.ttl                      PT15M series descriptor → its period container
    2024/<month>/<day>/<id-c>.ttl        daily 15-min reading files (same {id}, deeper)
```

Time partitions first; the dataset `{id}` (a UUID stem) sits at the leaf and the depth
follows resolution (`observations/{year}/` for annual, `…/{month}/{day}/` for daily).
Scenario (actual / planned) is a property of the dataset captured by **which `{id}`**,
not by the path. A period container (`observations/{year}/`,
`observations/{year}/{month}/`) is the rollup target across the owner's datasets for that
period. A dataset is a single resource (or container, for series), so sharing exactly one
year is granting its `.acl`, exactly like a building.

## Entry / update / share in the UI

- **One "Energy for year Y" form per building** (`EnergyYearDialog`); chosen granularity
  drives the inputs (annual → metric figures; series → the Lastgang upload). Same
  regardless of producer, and available on edit since it's decoupled from building-create.
- **Add / update a year** = create or replace one `observations/{year}/<id>.ttl`; the
  building file changes only in its `cons:hasEnergyDataset` link.
- **Share a single year** = the share dialog lists the building's datasets; granting one
  grants that resource's `.acl`.
- **Planned vs actual** = a `cons:Planned` dataset (its own `{id}`) alongside the
  `cons:Actual` one for the same year; `AnnualEnergy` overlays the planned (Soll) figures
  beside the actual per metric/year.

## Rendering across resolutions

A building may carry datasets of both kinds at once. The render surfaces never
pick one for the user: wherever a building's energy is shown (the **Observations**
finder, the building's `/observation` page), each kind present gets its view, and with
both present a small toggle switches between them (`EnergyResolutionSwitch`; the kind
split is `splitEnergyDatasets`, `src/lib/energyResolution.ts`). Annual is the default —
the aggregates are already bulk-loaded — and the series keeps its lazy load until
selected, so the toggle changes nothing about the load strategy.

Deferred decisions, deliberately not built yet:

- **Intermediate cadences.** `P1M`/`PT1H` are model-legal but unminted; the
  aggregate view assumes annual (kWh/a labels, one figure per metric, the year
  title). Generalising it to period-generic rendering waits until a real
  producer of such data exists — the load split already handles any cadence.
- **Series → annual derivation.** A series-only building takes no part in
  benchmarks, portfolio/operator averages, or aggregations. If that is ever wanted,
  prefer write-time summary observations in the series *descriptor* (it is
  already fetched at bulk-load and is overwritten atomically with the upload)
  over a derived `P1Y` dataset (a dual representation of the same readings) or
  render-time folding (fetching a year of daily files defeats the lazy layout).
- **Mixed-resolution comparison.** When datasets of different cadences are
  compared, compare at the coarsest resolution present: finer data rolls up,
  coarser data is never interpolated down.

## Decisions

- **Every dataset is its own time-first resource** (`observations/{year}/<id>.ttl`),
  annual included — uniform, and per-year sharing + per-year edit fall out for free, and
  a reading bound to no building still has a home. The cost is that annual energy isn't
  inline in the building file, so the energy panel fetches datasets (lazy + parallel,
  bounded by *visible* buildings); if that proves slow, add a tiny inline per-building
  *summary* rather than a second representation of the data. (A hybrid of inline-annual +
  separate-series was rejected as a dual representation.)
- **Scenario at the dataset level** (`cons:scenario cons:Actual | cons:Planned`,
  distinguished by the dataset's own `{id}`). Members stay `sosa:Observation` for both
  (one parser path; a planned value as an "observation" is an accepted mild stretch).
  Soll-Ist = diff the two datasets for the same (building, year, metric).
- **Opaque `{id}` leaf, time-first path.** The dataset file name is a UUID stem; the
  period and granularity live in the triples (`sosa:phenomenonTime`, `cons:granularity`)
  and the time partition is in the path, so a leaf is unique without encoding the period
  in the slug.
- **Metric set**: `cons:ElectricityConsumption` (kWh), `cons:HeatConsumption` (kWh),
  `cons:WaterConsumption` (m³), `cons:WastewaterConsumption` (m³),
  `cons:RenewableSelfGeneratedShare` (%), `cons:ElectricityGeneration` (kWh). The
  renewable share is a per-year observation (it varies by year), not a building attribute.
