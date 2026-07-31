# The observation cube — a sketch

The diagram companion to [`observation-cube.md`](./observation-cube.md), which states the
model in prose (a `sosa:Observation` *is* a cube cell; the cube is the dimensional space of
those cells). This note draws it: the axes with their rollup levels, the star schema around
the fact, example cells, and the OLAP-operation ↔ app-feature map.

## The cube at a glance

Three navigational axes span the cell space; the measure (value + unit + attributes) lives
*in* the cell, not on an axis:

```text
        property (metric)
        ▲
        │            ┌──────────────────────┐
  water ┤           ╱                      ╱│
        │          ╱          ■           ╱ │
    gas ┤         ╱   one cell:          ╱  │
        │        ┌──────────────────────┐   │      ■ = (B1, electricity, 2023)
  elec. ┤        │                      │   │            → 12 400 kWh
        │        │                      │  ╱             (unit, fn, n, ref. area)
        │        │                      │ ╱
        │        └──────────────────────┘╱
        └────────┬──────┬──────┬──────┬───────▶ time
        ╱      2021   2022   2023   2024
       ╱
      ▼ feature (space)
   B1, B2, … ⊂ Gemeinde ⊂ Kreis ⊂ Land ⊂ Bund
```

A fourth, thin axis — the producing **agent** — is drawn below; it slices but never rolls
up, and sharing is deliberately *not* an axis (see §Non-dimensions).

## The axes and their levels

Each axis has a finest grain and a ladder of rollup levels; "aggregation" is just moving
up a ladder.

| axis | finest grain | rollup levels | in the code |
| --- | --- | --- | --- |
| **feature** (space) | one building | ad-hoc set (`buildingUris`) → Gemeinde (LAU) → Kreis → Land → Bund | `regionRollup.ts` (`RegionLevel`), `SpatialExtent` |
| **time** | `PT15M` timestamp | year → period (multi-year span of a definition) | `splitEnergyDatasets` / `EnergyResolutionSwitch`, `period` on `AggregationDefinition` |
| **property** (metric) | one carrier (electricity, gas, water, heat, …) | all-carriers intensity total (the map lens) | `?m=` axis (`observationsAxes.ts`), consumption vocabulary IRIs |
| **agent** | producing organisation | — (flat, degenerate) | `Building.attributedTo` (`prov:agent`) |

## The star schema around a cell

The coordinates are properties *on the fact* — SOSA is already fact-table-shaped:

```text
   ┌─────────────────────┐                  ┌─────────────────────┐
   │     dim: FEATURE    │                  │      dim: TIME      │
   │ building │ region   │                  │ PT15M ts │ year     │
   └──────────┬──────────┘                  └──────────┬──────────┘
              │ sosa:hasFeatureOfInterest              │ sosa:resultTime
              ▼                                        ▼
        ┌───────────────────────────────────────────────────┐
        │                 FACT — the cell                   │
        │                (sosa:Observation)                 │
        │  measure:  value + unit                           │
        │  attrs:    aggregation fn (Ø/∑/min/max), n,       │
        │            reference area → derived kWh/m²·a     │
        └───────────────────────────────────────────────────┘
              ▲                                        ▲
              │ sosa:observedProperty                  │ prov:agent
   ┌──────────┴──────────┐                  ┌──────────┴──────────┐
   │    dim: PROPERTY    │                  │     dim: AGENT      │
   │ carrier metric IRI  │                  │ producing org WebID │
   └─────────────────────┘                  └─────────────────────┘
```

The same cell has two serializations — own cells as SOSA, external regional statistics as
`qb:Observation` — converged only at the in-memory app series
([`observation-cube.md`](./observation-cube.md) §Two serializations).

## Example cells

Four rows of the (virtual) fact table, differing only in coordinates and provenance:

| feature | property | time | agent | value | attrs | stored as |
| --- | --- | --- | --- | --- | --- | --- |
| building B1 | electricity | 2023 | owner's org | 12 400 kWh | — | SOSA reading in B1's `cons:EnergyDataset` |
| building B1 | electricity | 2023‑04‑01T10:15 | owner's org | 3.1 kWh | resolution `PT15M` | lazy-loaded series dataset |
| portfolio {B1…B7} | electricity | 2023 | the user | Ø 96 kWh/m²·a | fn = Ø, n = 7 | `AggregationSnapshot` (materialized) |
| Kreis Fürth | electricity | 2023 | statistics office | Ø town figure | level = kreis | external `qb:` cube, adapted by `regionalCube.ts` |

A **benchmark** is the third row computed by *another* agent over buildings shared to it
and shared back — the same cell shape, different `computedBy`
(`benchmarkSelector.ts` picks it for the comparison table).

## OLAP operations ↔ app features

| operation | meaning here | surface |
| --- | --- | --- |
| **slice** | fix metric + year, vary feature | map energy lens / regional choropleth (`?m=`, `?y=`) |
| **dice** | restrict several axes at once | Observations finder filters (list view) |
| **roll-up** | buildings → set/region, readings → fn(value) | `aggregationComputer` + `regionRollup`; snapshot = the result |
| **drill-down** | year → `PT15M` on the time axis; a region row → one feature level finer, scoped to it | `EnergyResolutionSwitch` (annual ⇄ time series); the pivot's region-row drill (`?in=`) |
| **pivot** | swap which axis is rows vs series | `overtime` (buildings × years heatmap) vs `overyears` (time x-axis, building series); `pivot` moves the row axis up the feature ladder (`?rows=`) — `observationsAxes.ts`, `pivot.ts` |

## Materialization — which cells are stored

Facts are distributed across Pods, so free navigation of the cube is priced in cross-Pod
fan-out. The discipline: **navigate freely within materialized cells; crossing a
materialization boundary is an explicit fetch.**

- **Base cells** — the building's annual datasets: fetched per source, fold-on-read.
- **Finest time level** (`PT15M`) — stored, but lazy-loaded on drill-down only.
- **Rolled-up cells** — `AggregationSnapshot`s persisted on the Pod; recompute = refresh
  the materialized cell. Benchmarks are snapshots materialized *by another agent*.
- **External cells** — pre-materialized by the regional-statistics wrapper (`qb:`), read
  through its adapter; never rolled up client-side.

## Non-dimensions

Two things look like axes but aren't:

- **Sharing / rooms** — a *visibility mask* over the cube (which cells you can see at
  all), enforced by WAC; pivoting on it makes no sense. The agent axis is only the
  *producer* (attribution), kept flat.
- **Building master data** — entity/document-shaped, not fact-shaped. The cube covers the
  numbers; the Add/Edit/sharing surfaces stay entity-oriented.

And one standing caveat: the cube is **very sparse** (metrics are pick-and-choose at a
user-chosen depth), so projections render as charts and maps — or as a **sparse-pruned**
pivot grid (`pivot` view, `cube/pivot.ts`: rows = a chosen feature level, columns =
years, all-gap rows and columns dropped), never as a dense one.
