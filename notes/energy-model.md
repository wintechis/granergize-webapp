# Energy model — one `cons:EnergyDataset` per (building, year, granularity)

Every energy reading is a `cons:EnergyDataset` that declares its own granularity,
period, and scenario; a building references each via a single `cons:hasEnergyDataset`
predicate. This is the *representation* counterpart to behaviour already dispatching on
declared granularity rather than role (see [`data-schema.md`](./data-schema.md));
resources are laid out container-native per [`storage-model.md`](./storage-model.md).

The unified shape replaces what used to be three linking predicates
(`investor:hasInvestorAnnualData`, `cons:hasEnergyConsumptionDataset`,
`cons:hasEnergyMeasurementData`), two layouts (inline vs located), and two metric
vocabularies (`investor:Annual…` vs `cons:…`). With one abstraction —
"a building has an energy dataset for year Y at granularity G" — adding, editing, and
sharing a single year all fall out uniformly, and there is one entry form for every
role.

## Principles

- **One link, one shape.** A building references each dataset with `cons:hasEnergyDataset`;
  every dataset is a `cons:EnergyDataset` declaring its granularity, period, and scenario.
- **Dispatch on declared shape, never role.** The data is uniform, so the parser keys on
  one predicate and the loader on the declared period.
- **A dataset is addressable.** Each (building, year, granularity) dataset is its own
  resource (or container, for series), so it can be added, edited, and shared independently.
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
`cons:WaterConsumption`, `cons:WastewaterConsumption`, `cons:RenewableSelfGeneratedShare`.

### Annual aggregate (small → inline in its own dataset resource)

```turtle
# …/buildings/<id>/energy/2024-P1Y.ttl
@prefix cons: <https://solid.ti.rw.fau.de/gra/consumption.ttl#> .
@prefix sosa: <http://www.w3.org/ns/sosa/> .
@prefix ssn:  <http://www.w3.org/ns/ssn/> .
@prefix time: <http://www.w3.org/2006/time#> .
@prefix unit: <https://qudt.org/vocab/unit#> .
@prefix xsd:  <http://www.w3.org/2001/XMLSchema#> .

<#ds> a cons:EnergyDataset , sosa:ObservationCollection ;
   cons:ofBuilding  <../b-1.ttl#b-1> ;
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

### Time series (sub-hourly; large → a located container of daily reading files)

```turtle
# in …/buildings/<id>/energy/2024-PT15M.ttl (the dataset descriptor)
<#ds> a cons:EnergyDataset ;
   cons:ofBuilding     <../b-1.ttl#b-1> ;
   cons:granularity    "PT15M" ;
   cons:scenario       cons:Actual ;
   sosa:phenomenonTime [ a time:Interval ;
        time:hasBeginning "2024-01-01"^^xsd:date ;
        time:hasEnd       "2024-12-31"^^xsd:date ] ;
   cons:datasetLocation <2024-PT15M/> .           # container of daily reading files
```

Each daily file under `2024-PT15M/` holds the readings (`sosa:Observation` per 15-min
slot). Unlike the aggregates, the series is never bulk-loaded: the descriptor's
time-only `cons:granularity "PT15M"` marks it lazy, and the daily files are fetched
only when the user opens that building's series chart.

### The building link (one predicate)

```turtle
<#b-1> cons:hasEnergyDataset <energy/2024-P1Y.ttl#ds> ,
                             <energy/2023-P1Y.ttl#ds> ,
                             <energy/2024-PT15M.ttl#ds> .
```

## Resource layout

```
buildings/<id>.ttl                       building master data (+ cons:hasEnergyDataset links)
buildings/<id>/energy/
    2024-P1Y.ttl                         annual aggregate (inline observations)
    2023-P1Y.ttl
    2024-P1Y-planned.ttl                 Soll: planned figures for the same year
    2024-PT15M.ttl                       series descriptor → location
    2024-PT15M/                          daily 15-min reading files (container)
        2024-01-01.ttl …
```

Discovery = list `buildings/<id>/energy/`. A year/granularity is a single resource (or
container), so sharing exactly one year is granting its `.acl`, exactly like a building.

## Entry / update / share in the UI

- **One "Energy for year Y" form per building** (`EnergyYearDialog`); chosen granularity
  drives the inputs (annual → metric figures; series → the Lastgang upload). Same for
  every role, and available on edit since it's decoupled from building-create.
- **Add / update a year** = create or replace one `…/energy/<year>-<g>.ttl`; the building
  file changes only in its `cons:hasEnergyDataset` link.
- **Share a single year** = the share dialog lists the building's datasets; granting one
  grants that resource's `.acl`.
- **Planned vs actual** = a `cons:Planned` dataset alongside the `cons:Actual` one for the
  same year; `AnnualEnergy` overlays the planned (Soll) figures beside the
  actual per metric/year.

## Rendering across resolutions

A building may carry datasets of both kinds at once. The render surfaces never
pick one for the user: wherever a building's energy is shown (the map's Energy
tab, `/energy/:id`), each kind present gets its view, and with both present a
small toggle switches between them (`EnergyResolutionSwitch`; the kind split is
`splitEnergyDatasets`, `src/lib/energyResolution.ts`). Annual is the default —
the aggregates are already bulk-loaded — and the series keeps its lazy load
until selected, so the toggle changes nothing about the load strategy.

Deferred decisions, deliberately not built yet:

- **Intermediate cadences.** `P1M`/`PT1H` are model-legal but unminted; the
  aggregate view assumes annual (kWh/a labels, one figure per metric, the year
  title). Generalising it to period-generic rendering waits until a real
  producer of such data exists — the load split already handles any cadence.
- **Series → annual derivation.** A series-only building takes no part in
  benchmarks, portfolio/operator averages, or views. If that is ever wanted,
  prefer write-time summary observations in the series *descriptor* (it is
  already fetched at bulk-load and is overwritten atomically with the upload)
  over a derived `P1Y` dataset (a dual representation of the same readings) or
  render-time folding (fetching a year of daily files defeats the lazy layout).
- **Mixed-resolution comparison.** When datasets of different cadences are
  compared, compare at the coarsest resolution present: finer data rolls up,
  coarser data is never interpolated down.

## Decisions

- **Every year is its own resource** (`energy/<year>-P1Y.ttl`, `energy/<year>-PT15M.ttl`),
  annual included — uniform, and per-year sharing + per-year edit fall out for free. The
  cost is that annual energy isn't inline in the building file, so the energy-mix panel
  fetches datasets (lazy + parallel, bounded by *visible* buildings); if that proves slow,
  add a tiny inline per-building *summary* rather than a second representation of the data.
  (A hybrid of inline-annual + separate-series was rejected as a dual representation.)
- **Scenario at the dataset level** (`cons:scenario cons:Actual | cons:Planned`). Members
  stay `sosa:Observation` for both (one parser path; a planned value as an "observation"
  is an accepted mild stretch). Soll-Ist = diff the two datasets for the same
  (building, year, metric).
- **Readable URI slug** `<year>-<granularity>[-planned].ttl` — the period is also in the
  triples; the slug is self-describing, sortable, and naturally unique per
  (building, year, granularity, scenario).
- **Metric set**: `cons:ElectricityConsumption` (kWh), `cons:HeatConsumption` (kWh),
  `cons:WaterConsumption` (m³), `cons:WastewaterConsumption` (m³),
  `cons:RenewableSelfGeneratedShare` (%). The renewable share is a per-year observation
  (it varies by year), not a building attribute.
