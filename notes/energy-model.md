# Energy model — one `gran:EnergyDataset` per (building, year, granularity)

Every energy reading is a `gran:EnergyDataset` that declares its own granularity,
period, and scenario; a building references each via a single `gran:hasEnergyDataset`
predicate. This is the *representation* counterpart to behaviour already dispatching on
declared granularity rather than role (see [`data-schema.md`](./data-schema.md));
resources are laid out container-native per [`storage-model.md`](./storage-model.md).

The unified shape replaces what used to be three linking predicates
(`investor:hasInvestorAnnualData`, `gran:hasEnergyConsumptionDataset`,
`gran:hasEnergyMeasurementData`), two layouts (inline vs located), and two metric
vocabularies (`investor:Annual…` vs `gran:…`). With one abstraction —
"a building has an energy dataset for year Y at granularity G" — adding, editing, and
sharing a single year all fall out uniformly, and there is one entry form for every
role.

## Principles

- **One link, one shape.** A building references each dataset with `gran:hasEnergyDataset`;
  every dataset is a `gran:EnergyDataset` declaring its granularity, period, and scenario.
- **Dispatch on declared shape, never role.** The data is uniform, so the parser keys on
  one predicate and the loader on the declared period.
- **A dataset is addressable.** Each (building, year, granularity) dataset is its own
  resource (or container, for series), so it can be added, edited, and shared independently.
- **Observations stay SOSA.** The reading shape is unchanged (`sosa:Observation` +
  `sosa:hasResult` + `sosa:phenomenonTime`); only the grouping and metric IRIs unify.
- **Granularity is a duration literal,** not a minted class: `"P1Y"`, `"P1M"`, `"PT15M"`
  — the value `isSeriesGranularity` switches on.

## The unified dataset

Metric IRIs unify under `gran:` (no `investor:` split, no "Annual" prefix — the period
is declared separately): `gran:ElectricityConsumption`, `gran:HeatConsumption`,
`gran:WaterConsumption`, `gran:WastewaterConsumption`, `gran:RenewableSelfGeneratedShare`.

### Annual aggregate (small → inline in its own dataset resource)

```turtle
# …/buildings/<id>/energy/2024-P1Y.ttl
@prefix gran: <https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#> .
@prefix sosa: <http://www.w3.org/ns/sosa/> .
@prefix ssn:  <http://www.w3.org/ns/ssn/> .
@prefix time: <http://www.w3.org/2006/time#> .
@prefix unit: <https://qudt.org/vocab/unit#> .
@prefix xsd:  <http://www.w3.org/2001/XMLSchema#> .

<#ds> a gran:EnergyDataset , sosa:ObservationCollection ;
   gran:ofBuilding  <../b-1.ttl#b-1> ;
   gran:granularity "P1Y" ;
   gran:scenario    gran:Actual ;                 # or gran:Planned (Soll-Ist)
   sosa:phenomenonTime [ a time:Interval ;
        time:hasBeginning "2024-01-01"^^xsd:date ;
        time:hasEnd       "2024-12-31"^^xsd:date ] ;
   sosa:hasMember
      [ a sosa:Observation ; sosa:observedProperty gran:ElectricityConsumption ;
        sosa:hasResult [ sosa:hasSimpleResult "121500"^^xsd:decimal ;
                         ssn:hasUnit unit:KiloW-HR ] ] ,
      [ a sosa:Observation ; sosa:observedProperty gran:HeatConsumption ;
        sosa:hasResult [ sosa:hasSimpleResult "232000"^^xsd:decimal ;
                         ssn:hasUnit unit:KiloW-HR ] ] ,
      [ a sosa:Observation ; sosa:observedProperty gran:WaterConsumption ;
        sosa:hasResult [ sosa:hasSimpleResult "1500"^^xsd:decimal ;
                         ssn:hasUnit unit:M3 ] ] .
```

### Sub-hourly series (large → a located container of daily reading files)

```turtle
# in …/buildings/<id>/energy/2024-PT15M.ttl (the dataset descriptor)
<#ds> a gran:EnergyDataset ;
   gran:ofBuilding     <../b-1.ttl#b-1> ;
   gran:granularity    "PT15M" ;
   gran:scenario       gran:Actual ;
   sosa:phenomenonTime [ a time:Interval ;
        time:hasBeginning "2024-01-01"^^xsd:date ;
        time:hasEnd       "2024-12-31"^^xsd:date ] ;
   gran:datasetLocation <2024-PT15M/> .           # container of daily reading files
```

Each daily file under `2024-PT15M/` holds the readings (`sosa:Observation` per 15-min
slot). The series is lazy-loaded — the descriptor's `gran:granularity "PT15M"` drives that.

### The building link (one predicate)

```turtle
<#b-1> gran:hasEnergyDataset <energy/2024-P1Y.ttl#ds> ,
                             <energy/2023-P1Y.ttl#ds> ,
                             <energy/2024-PT15M.ttl#ds> .
```

## Resource layout

```
buildings/<id>.ttl                       building master data (+ gran:hasEnergyDataset links)
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
  file changes only in its `gran:hasEnergyDataset` link.
- **Share a single year** = the share dialog lists the building's datasets; granting one
  grants that resource's `.acl`.
- **Planned vs actual** = a `gran:Planned` dataset alongside the `gran:Actual` one for the
  same year; `InvestorEnergy` / `BspEnergy` overlay the planned (Soll) figures beside the
  actual per metric/year.

## Decisions

- **Every year is its own resource** (`energy/<year>-P1Y.ttl`, `energy/<year>-PT15M.ttl`),
  annual included — uniform, and per-year sharing + per-year edit fall out for free. The
  cost is that annual energy isn't inline in the building file, so the energy-mix panel
  fetches datasets (lazy + parallel, bounded by *visible* buildings); if that proves slow,
  add a tiny inline per-building *summary* rather than a second representation of the data.
  (A hybrid of inline-annual + separate-series was rejected as a dual representation.)
- **Scenario at the dataset level** (`gran:scenario gran:Actual | gran:Planned`). Members
  stay `sosa:Observation` for both (one parser path; a planned value as an "observation"
  is an accepted mild stretch). Soll-Ist = diff the two datasets for the same
  (building, year, metric).
- **Readable URI slug** `<year>-<granularity>[-planned].ttl` — the period is also in the
  triples; the slug is self-describing, sortable, and naturally unique per
  (building, year, granularity, scenario).
- **Metric set**: `gran:ElectricityConsumption` (kWh), `gran:HeatConsumption` (kWh),
  `gran:WaterConsumption` (m³), `gran:WastewaterConsumption` (m³),
  `gran:RenewableSelfGeneratedShare` (%). The renewable share is a per-year observation
  (it varies by year), not a building attribute.
