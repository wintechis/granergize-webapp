# Regional statistics (linked-regionalstatistik) ↔ our model

`linked-regionalstatistik` (`~/projects/linked-regionalstatistik`) publishes
the German Regionalstatistik / GENESIS tables as an **RDF Data Cube** (`qb:`,
Turtle). The app reads it through `src/services/regionalCube.ts` (with
`src/services/openRegional.ts` / `src/hooks/regional.ts` picking the region). It
shares the LDP/RDF patterns catalogued in `mastr.md`; this note records the
cube-specific part and the convergence with our SOSA model.

## Access path

**Curated catalogue + constructible deref** — no discovery call, no SPARQL (the wrapper
exposes `/sparql`, but the app never uses it; see `README.md` §"Capability vocabulary").
The app holds a hardcoded table registry (`REGIONAL_TABLES` in `regionalCube.ts`:
`{tableId, dimensions, geo style, unit}`), so the table IRIs are known up front;
`regionalTableDataUrl(tableId)` builds the constructible path **`<base>data/{tableId}`**
and GETs the whole table as Turtle (`trackedFetch`, CORS-direct). *Which* region to show
is derived **from the user's buildings** — their coordinates → AGS — at no network cost
(`openRegional.ts` / `regional.ts`). Two reads, both whole-table deref + in-memory
projection: `fetchRegionalObservations(table, ags)` filters one region's **year-series**
(building-page panel), `fetchRegionalChoropleth(table)` takes the **latest value per
region** (the Aggregations map choropleth). Region identity is itself constructible —
`…/ags/{code}` or `…/cl/{scheme}#{code}` (`regionalGeoUrl`) — with `cl/geo` fetched once
to resolve AGS → Kreis name.

## Entities and vocabulary (Data Cube)

- **`qb:DataSet`** per table (`data/{tableId}`), with `qb:structure` →
  a **`qb:DataStructureDefinition`** of `qb:component`s.
- **Dimensions** — `TIME_PERIOD` (`xsd:gYear`, `sdmx-dimension:timePeriod`),
  `geo` (`skos:Concept`, `sdmx-dimension:refArea`, `qb:codeList → cl/geo`), and
  optional classifying dimensions (energy carrier, heating method, …) each with
  a `cl/{variable}` SKOS codelist.
- **Measure** — `OBS_VALUE` (`xsd:decimal`, `sdmx-measure:obsValue`), with a
  unit attribute literal.
- **`qb:Observation`** — one cell = `(region, year[, classifying dims]) →
  (value, unit)`. Region is keyed by **AGS** (2-digit Bundesland or 5-digit
  Kreis). Predicates are table-scoped (`ds/{tableId}#dim-…`), so the parser
  matches by suffix; multi-dimensional tables are collapsed to one series per
  year by fixing the auxiliary dimensions to chosen members.

The app joins **Bundesland-grain** tables via the building's region name → 2-digit
AGS, and **Kreis-grain** tables via the 5-digit AGS reverse-geocoded from nearby
MaStR units; each parses to a common `(year → value + unit)` series.

## Correspondence to our model

This is the **convergence** case. Our aggregations are SOSA rollups (an
aggregation snapshot is an observation at a coarser place × time —
`consumption.ttl`); a `qb:Observation` is the *same idea from a different
lineage* — a measured value located by dimensions. They meet at the parsed-series
edge: each adapter emits `(period, measure) → value + unit`, so an official
statistic slots in as a **reference series** beside our own aggregations and
received benchmarks. The differences are real but conceptual, not blocking:

- **Declarative vs procedural.** `qb:` carries the structure explicitly (DSD,
  components, SKOS codelists, a slice/rollup algebra); SOSA carries the *act*
  (procedure, sensor, PROV) and leaves dimensionality per-observation.
- **Pre-rolled-up and opaque.** The statistic arrives already aggregated to its
  official grain — you cannot drill down to members. That is exactly our
  **privacy-flattened aggregation snapshot** (drop the members, keep the
  aggregate + count): a statistic is the same "can't drill down" shape, reached
  by a different motivation.

## Patterns

Same as `mastr.md`: thing-vs-document split; **controlled vocab as SKOS
codelists** (`cl/{scheme}`, region labels via `skos:notation`/`skos:prefLabel`);
**place as a borrowed, AGS-keyed SKOS region** (`cl/geo`); PROV/`dcterms:license`
(dl-de/by) on the dataset.

## Divergence

It is a **materialised, pre-aggregated projection**: fixed-grain, member-less,
non-decomposable — the producer rolled it up and the app consumes the cell as-is
(it cannot recompute or refine it). And its vocabulary is `qb:`, not SOSA — the
one source where the cube structure is first-class rather than implied.
