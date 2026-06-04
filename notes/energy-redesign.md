# Energy model redesign — one `gran:EnergyDataset` per (building, year, granularity)

> **Status: DRAFT — refining.** Companion to
> [`storage-redesign.md`](./storage-redesign.md) and the "Concrete proposal" /
> "Open vocab question" in [`data-schema.md`](./data-schema.md). Captures the target
> energy data model before any code.

## Why

The energy model is **fragmented by producer shape**, which is the single root cause of
a whole cluster of reported problems:

- **investor** → inline annual SOSA observations (`investor:hasInvestorAnnualData`,
  `investor:AnnualElectricityConsumption`, …)
- **benchmark** → inline annual SOSA observations (same shape, single year)
- **user / dummy** → a *separate* dataset linked by `gran:hasEnergyConsumptionDataset`
  / `gran:hasEnergyMeasurementData`, pointing at a file (15-min daily files, or an
  annual file)

So there are **three linking predicates**, **two layouts** (inline vs located), and
**two metric vocabularies** (`investor:Annual…` vs `gran:…`). There is no single
"a building has an energy dataset for year Y at granularity G" abstraction — which is
exactly why you can't uniformly add a year, edit a year, or share one year, and why the
entry form differs per role.

The provenance refactor already did the *first half*: energy now **loads and renders by
declared granularity, not role** (`isSeriesGranularity`, `durationUtils.ts`). This note
is the *second half* — unifying the **representation**.

### Problems this addresses

- **#4** energy entry inconsistent across roles, **#19** no standardized input mask →
  one dataset shape ⇒ one form for every role.
- **#5** can't add/update a year (BSP fields vanish on edit) → a year is an independent
  dataset resource, added/edited on its own.
- **#7** a building should carry annual energy uniformly → one link, one shape.
- **#17** can't share a single year → each year/granularity is its own resource, so the
  ACL can grant exactly one year (ties into the storage redesign).
- **#16 / #15** planned-vs-actual (Soll-Ist) → a dataset carries `gran:scenario`
  (actual | planned); two datasets per year enable the comparison.

Out of scope: **#6** (import perf / cancel) and **#18** (external-knowledge linking) —
separate concerns, untouched here.

## Principles

- **One link, one shape.** A building references each energy dataset with a single
  predicate `gran:hasEnergyDataset`; every dataset is a `gran:EnergyDataset` that
  *declares* its granularity, period, and scenario.
- **Dispatch on the declared shape, never the role.** Already true for load/render;
  this just makes the *data* uniform so the parser keys on one predicate.
- **A dataset is addressable.** Each (building, year, granularity) dataset is its own
  resource (or container, for series), so it can be added, edited, and **shared**
  independently.
- **Observations stay SOSA.** The reading shape is unchanged (`sosa:Observation` +
  `sosa:hasResult` + `sosa:phenomenonTime`); only the *grouping* and the *metric IRIs*
  unify.
- **Granularity is a duration literal,** not a minted class — resolves the
  `data-schema.md` "open vocab question" pragmatically: `"P1Y"`, `"P1M"`, `"PT15M"`
  (already what `isSeriesGranularity` reads).

## The unified dataset

Metric IRIs unify under `gran:` (drop the `investor:` split and the "Annual" prefix —
the period is declared separately): `gran:ElectricityConsumption`,
`gran:HeatConsumption`, `gran:WaterConsumption`, `gran:WastewaterConsumption`,
`gran:RenewableSelfGeneratedShare`.

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

Each daily file under `2024-PT15M/` holds the readings exactly as today
(`sosa:Observation` per 15-min slot; `gran:ElectricityConsumption`,
`sosa:hasResult`/`hasSimpleResult`, `sosa:phenomenonTime` interval). The series is
**lazy-loaded** (the descriptor's `gran:granularity "PT15M"` already drives that).

### The building link (one predicate, replaces three)

```turtle
<#b-1> gran:hasEnergyDataset <energy/2024-P1Y.ttl#ds> ,
                             <energy/2023-P1Y.ttl#ds> ,
                             <energy/2024-PT15M.ttl#ds> .
```

Replaces `investor:hasInvestorAnnualData`, `gran:hasEnergyConsumptionDataset`, and
`gran:hasEnergyMeasurementData`.

## Resource layout (ties to the storage redesign)

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

Discovery = list `buildings/<id>/energy/` (the storage redesign's container-native
principle). A year/granularity is a single resource (or container) ⇒ **share exactly
one year** by granting its `.acl` (#17), exactly like sharing a building.

## Entry / update / share (what changes in the UI)

- **One "Energy for year Y" form per building**, chosen granularity drives the inputs:
  annual → the metric figures; series → the Lastgang upload. Same for every role
  (#4, #19). Decoupled from building-create, so it's available on **edit** too (#5).
- **Add a year / update a year** = create or replace one `…/energy/<year>-<g>.ttl`
  resource; no touching the building file beyond its `gran:hasEnergyDataset` link.
- **Share a single year** = the share dialog lists the building's datasets; granting one
  grants that resource's `.acl` (#17). Falls straight out of one-resource-per-year.
- **Planned vs actual** = a `gran:Planned` dataset alongside the `gran:Actual` one;
  the building view computes the Soll-Ist delta per metric per year (#16 → #15).

## Migration

**None** — consistent with the storage redesign: wipe the Pod (`removeAppData`) and
re-seed via the new writers. `seedDemoBuildings` emits the unified datasets; the old
`investor:hasInvestorAnnualData` / `hasEnergyMeasurementData` /
`hasEnergyConsumptionDataset` shapes are dropped from reader and writer.

## Decisions (settled)

1. **Always-separate datasets** (confirmed). Every year is its own resource
   (`energy/<year>-P1Y.ttl`, `energy/<year>-PT15M.ttl`), annual included — uniform, and
   per-year sharing (#17) + per-year edit (#5) fall out for free. Cost: annual is no
   longer inline in the building file, so the energy-mix panel fetches datasets (lazy +
   parallel, bounded by *visible* buildings). If that proves too slow, add a tiny inline
   per-building *summary* later — not a second representation of the data.
   *Alternative considered:* inline annual node + separate series, externalising a year
   on share; rejected as a dual representation.
2. **Scenario at the dataset level**: `gran:scenario gran:Actual | gran:Planned`. Members
   stay `sosa:Observation` for both (one parser path; a planned value as an "observation"
   is a mild, accepted stretch). Soll-Ist (#16) = diff the actual vs planned dataset for
   the same (building, year, metric).
3. **Readable URI slug**: `<year>-<granularity>[-planned].ttl` (e.g. `2024-P1Y.ttl`,
   `2024-PT15M.ttl`, `2024-P1Y-planned.ttl`). The period is also in the triples; the slug
   is convenience — self-describing, sortable, naturally unique per (building, year,
   granularity, scenario).
4. **Metric set**: `gran:ElectricityConsumption` (kWh), `gran:HeatConsumption` (kWh),
   `gran:WaterConsumption` (m³), `gran:WastewaterConsumption` (m³),
   `gran:RenewableSelfGeneratedShare` (%). The renewable share is a **per-year
   observation** (it varies by year), not a building attribute. No new generation/PV
   metrics for now.
5. **Order**: do the **storage redesign first** (smaller; sets the container-native /
   no-migration / `removeAppData`+bootstrap patterns the energy work reuses), then this.
   They're largely independent — energy datasets are reached via the building's
   `gran:hasEnergyDataset` links, not by listing — so they *could* parallelise, but
   storage-first is the cleaner sequence. Both land under the single Pod wipe.

## Implementation sketch (after refinement)

Because the energy/annual types feed ~15 files (both parsers, `loadEnergy`, the
per-role charts, `viewComputer`, `share.ts`, `AddBuildingDialog`, tests), this is
done as **green-at-each-step increments** with a bridge (new `energyDatasets`
field added alongside the old `energyData`/`annualData`, consumers migrated one at
a time, old fields removed last) — not a single big-bang swap.

0. **Foundation (DONE)** — `services/utils/energyDataset.ts`: serialize/parse one
   `gran:EnergyDataset` (annual inline `sosa:ObservationCollection` + series
   descriptor), the `<year>-<granularity>[-planned]` slug + URL helpers, and link
   parsing. Unified metric IRIs (`gran:ElectricityConsumption` …). Round-trip tested.
1. **Reader, part 1 (DONE)** — `BuildingType.energyDatasets?: EnergyDatasetRef[]`
   (types in `types.ts`); `buildingParser` derives it from the
   `gran:hasEnergyDataset` link slugs (additive — old parsing still runs). Tested.
2. **Writer (DONE)** — `serializeBuildingToTurtle` emits only `gran:hasEnergyDataset`
   links (no inline energy); `annualDatasetsFromFields` converts the `_inv_*`/`_bsp_*`
   fields to annual `gran:EnergyDataset` objects; `writeBuildingEnergy` writes the
   dataset resources (annual `<year>-P1Y.ttl` + a located `<year>-PT15M.ttl`
   descriptor with daily files under `<year>-PT15M/`) and returns the link URLs.
   `seedDemoBuildings` + `AddBuildingDialog` use it. Dropped `addEnergyObservations`
   and the `investor:Annual…` metric consts. Tests updated.
3. **`loadEnergy` (DONE)** — reads each building's `energyDatasets`: the latest
   actual annual dataset is fetched (bounded concurrency) via `parseEnergyDataset`
   → `energyNeed`/averages (capitalized `Electricity`/`Heat`/… keys, as before);
   series stay lazy. Dropped the old `parseEnergyData`/`annualData`-synthesis
   paths from `loadEnergy`. The **map** energy panel/averages now work on the new
   model; the per-building **detail charts** still read the old fields (next).
4. **Charts (DONE)** — `UserEnergyChart` lists the series descriptor's
   `<year>-PT15M/` container for daily files; `InvestorEnergy`/`BspEnergy` fetch
   the building's annual datasets (`loadEnergyDatasets` + a `session` prop);
   `Energy.tsx` series branch + the `ExplorePage` energy gate dispatch on
   `energyDatasets` granularity; `viewComputer` aggregates from the datasets.
5. **Share / revoke energy (DONE)** — `share.ts getEnergyDataUrls` +
   `sharingManager getEnergyAclTargets` grant/revoke each `gran:EnergyDataset`
   resource (annual file / series descriptor) + a series' daily-files container.
6. **Excel export + Energieausweis (DONE)** — `attachAnnualData` fetches a
   building's annual datasets so the (sync) XLSX export still carries energy;
   the energy-certificate upload dialog got its missing trigger on `Building.tsx`.
7. **Energy e2e (DONE)** — `e2e/energy-smoke.spec.ts` opens a seeded building's
   `/energy/:id` and asserts the chart renders (needs a wipe+reseed Pod).

### Tail items — all DONE

8. **CreateViewDialog month picker (DONE)** — reads `energyDatasets`: lists each
   user building's series container(s) (async) for the available months.
9. **Cleanup (DONE)** — removed the old `buildingParser` energy passes
   (`hasEnergyMeasurementData` / `hasInvestorAnnualData` / inline-SOSA), the
   `energyData` field and the `EnergyMeasurementData` type. (`annualData` /
   `InvestorAnnualData` kept — the charts' fetched state + `attachAnnualData`.)
10. **Per-year entry (#5, DONE)** — `EnergyYearDialog` (a `Modal` form: year +
    scenario + the five metrics) writes one `<year>-<P1Y>[-planned].ttl` via
    `writeEnergyYear` and links it; triggered by an "Add / edit energy year"
    button on `Building.tsx` (own buildings — always reachable, even with no
    energy yet).
11. **Planned vs actual (#16, DONE)** — the entry form's scenario writes an
    `…-planned.ttl` dataset; `InvestorEnergy` / `BspEnergy` fetch BOTH scenarios
    and overlay the planned (Soll) figures beside the actual per metric/year
    (legend distinguishes them) — the Soll-Ist comparison.
