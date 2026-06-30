# The observation cube — one model for the numbers

Every quantity the app shows — a building's measured electricity, a portfolio average, an
official regional statistic — is **one cell of one cube**, and an observation is how a cell
is serialized. SOSA and "the cube" are not two models: a `sosa:Observation` **is** a cube
cell, and the cube is the dimensional *space* of those cells. This note states that single
model and how the data, the object layer and the UX all speak its one dimensional
vocabulary. Companion to [`energy-model.md`](./energy-model.md) (the SOSA cells on the Pod),
[`aggregations.md`](./aggregations.md) (a rollup of cells), [`data-architecture.md`](./data-architecture.md)
(the spatial hierarchy and the external `qb:` cells), and [`ui-state.md`](./ui-state.md)
(the finder axes that project the cube).

## A cell knows its coordinates

A cell is a measure positioned on a few dimensions, and a `sosa:Observation` carries exactly
that — the coordinates are properties *on the fact*:

- `sosa:hasFeatureOfInterest` → the **feature** (a building, a meter point, a region);
- `sosa:observedProperty` → the **property** (electricity, heat, water, wastewater, …);
- `sosa:resultTime` → the **time** (a year, or a sub-annual timestamp);
- `sosa:hasResult` → the **measure** — the value and its unit.

So a number is never orphaned: it *is* its coordinates plus a value. The recurring confusion
in the UI (a figure shown without saying which quantity, which year, which spatial unit) is
exactly a cell rendered without its coordinates — a model problem only in that the model says
*don't do that*: show the coordinate.

## The dimensions — the shared spine

One vocabulary runs through data, object model and UX:

feature (space)
: a building (own / shared) or a region. Regions form a containment hierarchy — LAU
  Gemeinde ⊂ NUTS Kreis ⊂ Bundesland — as external `skos:Concept`s joined by AGS
  ([`data-architecture.md`](./data-architecture.md)). A cell's spatial level is its feature's
  level.

property (the metric)
: the observed quantity, an IRI in the consumption vocabulary. This is the cube's **measure
  axis** in the UI — the metric selector (`m`, [`ui-state.md`](./ui-state.md)).

time
: a year for annual cells, a timestamp for the `PT15M` series; resolution is itself a depth
  on the time axis ([`energy-model.md`](./energy-model.md)).

measure + attributes
: the value, plus the attributes that make it interpretable — **unit**, **aggregation
  function** (Ø / sum / min / max, for a rolled-up cell), **sample size** `n` (the
  `buildingCount`), and the **reference area** for a normalised reading. A **derived measure**
  is computed from these: *intensity* = the measure ÷ the area attribute (kWh/m²·a).

## Two serializations of a cell, one app series

A cell appears in the graph in two RDF forms, deliberately **not** aligned at the RDF level:

- **own cells → SOSA.** A building's `cons:EnergyDataset` and an aggregation *snapshot* are
  both `sosa:ObservationCollection`s of member `sosa:Observation`s — the same shape, so one
  renderer serves measurement, aggregate and benchmark ([`energy-model.md`](./energy-model.md),
  [`aggregations.md`](./aggregations.md)).
- **external cells → `qb:`.** The regional statistics wrapper serves a true RDF Data Cube
  (`qb:Observation` in a geo×time×measure `qb:DataSet`); `regionalCube.ts` is its adapter.

The cell ⇄ observation kinship makes an RDF-level `qb:`↔SOSA alignment tempting, but it is
avoided: the two graphs stay native, and they **converge only at the app-level series** —
one small adapter per vocabulary (the SOSA energy parser; the `qb:` regional adapter) maps
each into the same in-memory observation series the UI reads. Convergence at the edge, not in
the triples.

## Aggregation is a cube operation

An aggregation is a **rollup** over the cell space, not a separate kind of thing: pick a level
on each axis — group a set of buildings up to a region / an operator / the portfolio, fix a
year, fix a metric — and reduce the measure with the chosen function, carrying the attributes
(`n` = how many cells, the function, the `spatialExtent` + period). A **benchmark** is the
same rollup computed by another agent and shared back. So a portfolio average, an operator
average, a peer benchmark and an official regional figure are all *cells one level up*,
differing only in who computes them and over which feature level — which is why they line up
beside a building's own cell in the same table ([`aggregations.md`](./aggregations.md)
§Peer benchmark).

## The UX is projections of the one cube

Every finder is a slice or rollup of the same cube; the URL axes ([`ui-state.md`](./ui-state.md))
*are* the cube coordinates held fixed or varied:

- the **Buildings** finder is the space/identity slice — `map | rows` over the building set
  (`services/cube/exploreAxes.ts`), the energy lens fixing one metric at each building's
  latest year;
- the **Observations** finder *is* the energy cube — view axis `map | list | overtime |
  overyears` (`services/cube/observationsAxes.ts`), with `m` the measure axis;
- the **Aggregations** finder shows rollups (list / region choropleth / cross-year timeline);
- the **regional choropleth** is a slice of the *external* cube — fix metric + year, vary the
  region feature.

Because every displayed figure is a coordinate, the model's discipline is: **a number is
labelled by its cell** (which feature, which property, which year, which unit). The present
gap is the Buildings list / map lens — it shows a per-m² intensity summed over carriers at
each building's *latest* year, unlabelled; the cube model names the fix (state the
coordinate: quantity, year, unit, and that the map's efficient/typical/inefficient tiers are
relative to the features in view).

## Why this is one model, not two

SOSA-with-its-dimensions and "the cube" are the same structure at two levels — the **cell** (a
fact, dimensions as properties on the node) and the **space** (the index over facts you slice,
dice and roll up). `qb:` is only the external serialization of the same cell. So there is one
dimensional spine, and the three layers inherit consistency from it rather than from a second
model: the **data** is SOSA/`qb:` cells, the **object model** is a typed observation with
dimension accessors (the star schema — a building dimension × an observation fact), and the
**UX** is projections of the cube. Keeping a single foreign *point* useful means anchoring it
to a building (a partial cell needing a feature); an aggregate needs no such anchor because it
is already a whole cell at a higher level.

Present state implements **static** projections (the finders above). Free navigation of the
cube — picking any level on any axis, deriving arbitrary 2-D views, formalising the geo/time
dimensions (QB4ST) — is sketched as future work, not built.
